/**
 * export.run.requested - specs/02-ARCHITECTURE.md section 4;
 * specs/05-EXPORT-ENGINE.md section 8 (failure handling).
 *
 * Written as discrete step.run() calls so a transient failure only retries
 * the step that failed, not the whole run:
 *   1. load-and-mark-running    load ExportDefinition/Portal, ExportRun -> RUNNING
 *   2. fetch-associate-write    fetch pages, resolve associations, write the XLSX
 *   3. upload                   stream the file to R2, presign a download URL
 *   4. send-success-email       Resend, idempotent
 *   5. mark-success             ExportRun -> SUCCESS
 * On definitive failure (see below): mark-failed, send-failure-email, run in
 * `onFailure` (exportRunOnFailure), not inline in the main handler.
 *
 * DECISION A: the architecture spec lists "fetch pages", "resolve associations"
 * and "write XLSX" as three separate steps. They are combined into ONE step
 * here (step 2, "fetch-associate-write"). A step.run() return value is
 * memoized by Inngest and must be JSON-serializable; splitting fetch,
 * associate and write into separate steps would force materializing the
 * full record set between them - the opposite of "a 250,000-row export must
 * keep memory flat", the explicit, repeated design constraint behind
 * lib/export/fetch.ts and lib/export/writer.ts (fetch a page, write it,
 * discard, never accumulate). Combining them keeps the pipeline streaming
 * end to end inside one step, whose result is just
 * { filePath, rowCount, apiCallCount, skippedColumns } - small and
 * serializable. Retrying this step still retries only the export logic, not
 * the upload or the email.
 *
 * DECISION B: failure handling runs in Inngest's onFailure lifecycle hook,
 * not inline in a try/catch around the main steps. An earlier draft caught
 * every error inline and immediately ran mark-failed + send-failure-email
 * before re-throwing for Inngest to retry - which meant a run that failed
 * once transiently (e.g. a dropped network response while sending the
 * success email) got a FAILURE email even if the retry then succeeded and
 * ALSO sent a SUCCESS email. onFailure fires exactly once, and only once
 * Inngest has exhausted every retry attempt - the correct single place for
 * "every failure sends an email" (spec section 8), whether the failure was
 * immediate (a classified, non-retriable error - TOKEN_REVOKED,
 * SEARCH_CAP_EXCEEDED, RATE_LIMITED, TIMEOUT) or came after retries ran out.
 * Known-terminal errors are wrapped in NonRetriableError inside step 2 so
 * Inngest does not waste retries on them; classification is re-derived from
 * the error MESSAGE in onFailure (see parseFailureFromMessage) rather than
 * from `instanceof` checks, because by the time onFailure runs, Inngest may
 * have serialized the error across a retry/checkpoint boundary, and a
 * serialized error is not guaranteed to keep its original prototype chain.
 *
 * Idempotency:
 *   - A run already in a terminal state (SUCCESS or FAILED) is a no-op - see
 *     the check inside step 1 below. `idempotency: 'event.data.exportRunId'`
 *     on the function config should stop a duplicate event from reaching
 *     this handler at all, but the handler does not rely on that alone.
 *   - The ExportRun row is created by the event's emitter (scheduleTick.ts,
 *     or a future manual-run API route), not by this function - step 1 only
 *     transitions it, guarded by a QUEUED-only update so a retried step 1
 *     can't reset startedAt or double-transition a run already RUNNING.
 *   - The temp file path and R2 key are both derived from exportRunId, so a
 *     retried write/upload step overwrites the same file/object rather than
 *     creating a second one.
 *   - Both emails carry an idempotencyKey derived from exportRunId (see
 *     inngest/email.ts) so a retried send step can't double-send - Resend
 *     dedupes by that key even if the send call itself happens twice.
 *   - onFailure's own mark-failed/send-failure-email updates are
 *     status-guarded for the same reason.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { NonRetriableError } from 'inngest';
import { inngest, type Events } from './client';
import { prisma } from '@/lib/db';
import { RunStatus } from '@/lib/generated/prisma/client';
import { HubSpotClient } from '@/lib/hubspot/client';
import { GrantRevokedError } from '@/lib/hubspot/oauth';
import { AppError, ErrorCode } from '@/lib/errors';
import { fetchRecords, type HubSpotRecord, type Filters } from '@/lib/export/fetch';
import { resolveAssociations } from '@/lib/export/associations';
import { writeExport } from '@/lib/export/writer';
import { loadPropertyDefs, loadOwners } from './propertyDefs';
import { loadR2Config, uploadFileToR2, deriveObjectKey } from './r2';
import { sendSuccessEmail, sendFailureEmail, buildReconnectUrl, buildRunDownloadUrl } from './email';
import { disablePortalOnRevocation } from './revocation';
import { logger } from '@/lib/logger';
import { STALE_RUN_MS } from '@/lib/runs';

/**
 * spec section 8: "Run exceeds 30 minutes -> Fail with TIMEOUT." Same
 * constant inngest/staleRuns.ts uses for the mirror-image case (a run that
 * never started) - one 30-minute rule, not two independently-drifting ones.
 */
const MAX_RUN_MS = STALE_RUN_MS;

/** Thrown internally when a run exceeds MAX_RUN_MS. Never sent to HubSpot. */
class RunTimeoutError extends Error {
  constructor() {
    super("Export exceeded HubSpot's 30 minute run limit");
    this.name = 'RunTimeoutError';
  }
}

/**
 * Object-type display names for association column headers ("Company · Name").
 * writer.ts treats associationSpec.toObjectType as an already-human-ready
 * string (see tests/export/writer.test.ts's documented decision), distinct
 * from the lowercase-plural HubSpot API path segment resolveAssociations
 * needs. Only these four object types exist (schema ObjectType enum), so a
 * lookup table is exact - no pluralisation heuristics.
 */
const DISPLAY_OBJECT_TYPE: Record<string, string> = {
  CONTACTS: 'Contact',
  COMPANIES: 'Company',
  DEALS: 'Deal',
  TICKETS: 'Ticket',
};

interface StoredAssociationSpec {
  toObjectType: string; // e.g. "COMPANIES" - matches the ObjectType enum
  columns: string[];
}

function parseFilters(raw: unknown): Filters | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return raw as Filters;
}

function parseAssociationSpec(raw: unknown): StoredAssociationSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.toObjectType !== 'string' || !Array.isArray(obj.columns)) return undefined;
  return { toObjectType: obj.toObjectType, columns: obj.columns.filter((c): c is string => typeof c === 'string') };
}

function tempFilePathFor(exportRunId: string): string {
  return join(tmpdir(), `cleanexport-run-${exportRunId}.xlsx`);
}

interface RunFailure {
  code: string;
  message: string;
  retriable: boolean;
}

function classifyFailure(err: unknown): RunFailure {
  if (err instanceof RunTimeoutError) {
    return { code: ErrorCode.TIMEOUT, message: err.message, retriable: false };
  }
  if (err instanceof GrantRevokedError) {
    return { code: ErrorCode.TOKEN_REVOKED, message: err.message, retriable: false };
  }
  if (err instanceof AppError) {
    if (err.code === ErrorCode.SEARCH_CAP_EXCEEDED) {
      return { code: err.code, message: err.message, retriable: false };
    }
    if (err.code === ErrorCode.RATE_LIMITED) {
      // The client already backed off for up to 5 attempts inside this step
      // (lib/hubspot/client.ts) - a further Inngest-level retry would just
      // repeat that wait. Fail after that, as specced.
      return { code: err.code, message: err.message, retriable: false };
    }
    return { code: err.code, message: err.message, retriable: true };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: ErrorCode.INTERNAL, message, retriable: true };
}

/**
 * Encodes a classification onto a thrown error's message and decodes it back
 * in onFailure - see DECISION B above for why this doesn't rely on
 * `instanceof` surviving Inngest's serialization boundary.
 */
const FAILURE_PREFIX = /^\[([A-Z_]+)\] ([\s\S]*)$/;

function toStepError(err: unknown): Error {
  const failure = classifyFailure(err);
  const message = `[${failure.code}] ${failure.message}`;
  return failure.retriable ? new Error(message) : new NonRetriableError(message, { cause: err });
}

function parseFailureFromMessage(message: string): { code: string; message: string } {
  const match = FAILURE_PREFIX.exec(message);
  return match ? { code: match[1], message: match[2] } : { code: ErrorCode.INTERNAL, message };
}

/**
 * The handler, exported separately from the InngestFunction it's wired into
 * below so tests/inngest/exportRun.test.ts can call it directly with fake
 * step/prisma/client objects, without needing a live Inngest runtime.
 * `InngestFn` intentionally under-specifies `event`/`step` (just the surface
 * this handler actually uses) so a plain fake object satisfies the type
 * without importing Inngest's own execution-context types.
 */
export interface InngestFn {
  event: { data: Events['export.run.requested']['data'] };
  step: { run: <T>(idOrOptions: string | { id: string }, fn: () => T | Promise<T>) => Promise<T> };
}

export async function exportRunHandler({ event, step }: InngestFn) {
  const { exportRunId } = event.data;

  const setup = await step.run('load-and-mark-running', async () => {
    const run = await prisma.exportRun.findUnique({ where: { id: exportRunId } });
    if (!run) throw new NonRetriableError(`ExportRun ${exportRunId} does not exist`);

    // Idempotency, defence in depth: `idempotency: 'event.data.exportRunId'`
    // on the function config (below) should stop a duplicate event from
    // reaching this handler a second time at all, but a run already in a
    // terminal state must not be re-executed regardless of how it got here -
    // re-fetching, re-uploading and re-emailing on top of a completed run
    // would be exactly the "sent two emails" failure this file exists to
    // prevent. Only QUEUED/RUNNING proceed.
    if (run.status === RunStatus.SUCCESS || run.status === RunStatus.FAILED) {
      return { alreadyTerminal: true as const, rowCount: run.rowCount ?? 0 };
    }

    const exportDef = await prisma.exportDefinition.findUnique({ where: { id: run.exportId } });
    if (!exportDef) throw new NonRetriableError(`ExportDefinition ${run.exportId} does not exist`);

    const portal = await prisma.portal.findUnique({ where: { id: run.portalId } });
    if (!portal) throw new NonRetriableError(`Portal ${run.portalId} does not exist`);

    if (portal.disconnectedAt) {
      throw new NonRetriableError('Portal is disconnected; reconnect HubSpot before running this export');
    }

    // specs/05-EXPORT-ENGINE.md section 8: "a scheduled export failing
    // silently is worse than no scheduled export." A run with nobody to
    // deliver to did not succeed just because the file got generated -
    // fail loudly here, before spending any HubSpot API calls, rather than
    // marking SUCCESS and quietly sending nothing.
    if (exportDef.recipients.length === 0) {
      throw new NonRetriableError(`[${ErrorCode.NO_RECIPIENTS}] Export has no recipients configured; nothing was sent`);
    }

    // QUEUED-only guard: a retried invocation of this step (before Inngest
    // memoized its success) must not reset startedAt on a run already RUNNING.
    await prisma.exportRun.updateMany({
      where: { id: exportRunId, status: RunStatus.QUEUED },
      data: { status: RunStatus.RUNNING, startedAt: new Date() },
    });

    logger.info('export run started', { portalId: portal.id, exportRunId, exportId: exportDef.id });

    return {
      alreadyTerminal: false as const,
      portalId: portal.id,
      exportId: exportDef.id,
      exportName: exportDef.name,
      objectType: exportDef.objectType,
      properties: exportDef.properties,
      filters: parseFilters(exportDef.filters) ?? null,
      associationSpec: parseAssociationSpec(exportDef.associations) ?? null,
      headerStyle: exportDef.headerStyle,
      recipients: exportDef.recipients,
      timezone: exportDef.scheduleTz,
    };
  });

  if (setup.alreadyTerminal) {
    return { rowCount: setup.rowCount };
  }

  const writeResult = await step.run('fetch-associate-write', async () => {
    try {
      const client = await HubSpotClient.forPortal(setup.portalId, {
        onRevoked: disablePortalOnRevocation,
      });

      const propertyDefs = await loadPropertyDefs(client, setup.portalId, setup.objectType);
      const owners = await loadOwners(client);

      // spec section 8: "Property no longer exists in portal -> skip that
      // column, complete the run, list skipped columns in the email."
      // writer.ts does not drop unknown columns on its own (it falls back to
      // plain text with the internal name as the header) - filtering here,
      // before the properties list reaches fetchRecords/writeExport, is what
      // actually skips them.
      const knownProperties = setup.properties.filter((p) => propertyDefs.has(p));
      const skippedColumns = setup.properties.filter((p) => !propertyDefs.has(p));

      const objectTypeSlug = setup.objectType.toLowerCase();
      const filePath = tempFilePathFor(exportRunId);
      const startedAtMs = Date.now();

      // writeExport wants a human-ready object name for the column prefix
      // ("Company · Name"); resolveAssociations (below) wants the lowercase
      // HubSpot API slug ("companies"). Same stored value, two shapes.
      const displayAssociationSpec = setup.associationSpec
        ? {
            toObjectType: DISPLAY_OBJECT_TYPE[setup.associationSpec.toObjectType] ?? setup.associationSpec.toObjectType,
            columns: setup.associationSpec.columns,
          }
        : undefined;
      const associations = new Map<string, Record<string, unknown>>();

      async function* streamWithAssociations(): AsyncGenerator<HubSpotRecord[]> {
        for await (const page of fetchRecords(
          client,
          objectTypeSlug,
          knownProperties,
          setup.filters ?? undefined,
          propertyDefs,
        )) {
          if (Date.now() - startedAtMs > MAX_RUN_MS) throw new RunTimeoutError();

          if (setup.associationSpec) {
            const resolved = await resolveAssociations(
              client,
              objectTypeSlug,
              page.map((r) => r.id),
              { toObjectType: setup.associationSpec.toObjectType.toLowerCase(), columns: setup.associationSpec.columns },
            );
            for (const [id, values] of resolved) associations.set(id, values);
          }

          yield page;
        }
      }

      const { rowCount } = await writeExport({
        filePath,
        records: streamWithAssociations(),
        properties: knownProperties,
        propertyDefs,
        headerStyle: setup.headerStyle,
        associations: setup.associationSpec ? associations : undefined,
        associationSpec: displayAssociationSpec,
        owners,
        timezone: setup.timezone,
      });

      return { filePath, rowCount, apiCallCount: client.callCount, skippedColumns };
    } catch (err) {
      // Classified here (TOKEN_REVOKED / SEARCH_CAP_EXCEEDED / RATE_LIMITED /
      // TIMEOUT -> non-retriable; anything else -> retriable) while the
      // original error's class identity is still intact - see DECISION B.
      throw toStepError(err);
    }
  });

  const uploaded = await step.run('upload', async () => {
    const r2 = loadR2Config();
    // Non-guessable key (specs/02-ARCHITECTURE.md section 5) - see
    // deriveObjectKey's own comment for why this isn't just the run id.
    const key = deriveObjectKey(setup.portalId, exportRunId);
    const { sizeBytes } = await uploadFileToR2(r2, writeResult.filePath, key);

    await prisma.exportRun.update({
      where: { id: exportRunId },
      data: { fileKey: key, fileSizeBytes: sizeBytes },
    });

    // The temp file is NOT deleted here - defect #1 fix: the success email
    // (next step) needs to read it from disk to attach it when it's at or
    // under the 8 MB threshold (specs/05-EXPORT-ENGINE.md section 9). It was
    // previously unlinked in this same step, before the email step ever ran,
    // so a passed-through filePath would have pointed at a file that no
    // longer existed - see the 'cleanup-temp-file' step below instead.
    return { key, sizeBytes };
  });

  await step.run('send-success-email', () =>
    sendSuccessEmail({
      recipients: setup.recipients,
      idempotencyKey: `export-run-${exportRunId}`,
      exportName: setup.exportName,
      rowCount: writeResult.rowCount,
      // Defect #2: our own portal-scoped, re-signing route - never a raw R2
      // URL (see inngest/email.ts's buildRunDownloadUrl for why).
      downloadUrl: buildRunDownloadUrl(exportRunId),
      skippedColumns: writeResult.skippedColumns,
      // Both required for the 8 MB rule (spec section 9): sendSuccessEmail's
      // attachEligible check is `fileSizeBytes <= 8MB && filePath` - omitting
      // filePath here (as this call previously did) makes attachEligible
      // false unconditionally, regardless of size, so no file was EVER
      // attached and every run showed the "too large to attach" notice.
      filePath: writeResult.filePath,
      fileSizeBytes: uploaded.sizeBytes,
    }),
  );

  // Deferred until after the email is sent (see the 'upload' step above) -
  // reading the file to attach it must happen before it's deleted.
  await step.run('cleanup-temp-file', () => unlink(writeResult.filePath).catch(() => undefined));

  await step.run('mark-success', () =>
    prisma.exportRun.updateMany({
      where: { id: exportRunId, status: RunStatus.RUNNING },
      data: {
        status: RunStatus.SUCCESS,
        finishedAt: new Date(),
        rowCount: writeResult.rowCount,
        apiCallCount: writeResult.apiCallCount,
      },
    }),
  );

  logger.info('export run succeeded', { portalId: setup.portalId, exportRunId, rowCount: writeResult.rowCount });

  return { rowCount: writeResult.rowCount };
}

/**
 * Runs exactly once, only once Inngest has exhausted every retry attempt for
 * exportRunHandler (or immediately, for a NonRetriableError) - see DECISION B.
 * Exported separately, same reasoning as InngestFn/exportRunHandler above.
 */
export interface OnFailureFn {
  event: { data: { event: { data: Events['export.run.requested']['data'] } } };
  error: Error;
  step: { run: <T>(idOrOptions: string | { id: string }, fn: () => T | Promise<T>) => Promise<T> };
}

export async function exportRunOnFailure({ event, error, step }: OnFailureFn) {
  const { exportRunId } = event.data.event.data;
  const failure = parseFailureFromMessage(error.message);

  // A plain read, not wrapped in step.run: onFailure only runs once per run
  // (DECISION B above), and this has no side effect to make idempotent -
  // it's only here so the log line below can carry portalId.
  const runForLogging = await prisma.exportRun.findUnique({ where: { id: exportRunId }, select: { portalId: true } });
  logger.error('export run failed', { portalId: runForLogging?.portalId, exportRunId, errorCode: failure.code });

  await step.run('mark-failed', () =>
    prisma.exportRun.updateMany({
      where: { id: exportRunId, status: { in: [RunStatus.RUNNING, RunStatus.QUEUED] } },
      data: {
        status: RunStatus.FAILED,
        finishedAt: new Date(),
        errorCode: failure.code,
        errorMessage: failure.message.slice(0, 2000),
      },
    }),
  );

  await step.run('send-failure-email', async () => {
    const run = await prisma.exportRun.findUnique({ where: { id: exportRunId } });
    if (!run) return;
    const exportDef = await prisma.exportDefinition.findUnique({ where: { id: run.exportId } });
    if (!exportDef) return;

    await sendFailureEmail({
      recipients: exportDef.recipients,
      idempotencyKey: `export-run-${exportRunId}-failed`,
      exportName: exportDef.name,
      errorCode: failure.code,
      errorMessage: failure.message,
      reconnectUrl: failure.code === ErrorCode.TOKEN_REVOKED ? buildReconnectUrl() : undefined,
    });
  });

  await unlink(tempFilePathFor(exportRunId)).catch(() => undefined);
}

export const exportRun = inngest.createFunction(
  {
    id: 'export-run',
    triggers: [{ event: 'export.run.requested' }],
    retries: 2,
    // Same event delivered twice must not spawn a second run of the same export.
    idempotency: 'event.data.exportRunId',
    onFailure: exportRunOnFailure,
  },
  exportRunHandler,
);
