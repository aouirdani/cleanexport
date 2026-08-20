import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { unlink } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NonRetriableError } from 'inngest';
import { encrypt } from '@/lib/crypto';
import { RunStatus, Trigger } from '@/lib/generated/prisma/client';
import { ErrorCode } from '@/lib/errors';

// "The path that delivers the file to the customer" - the only untested code
// in the project until this file. No live Inngest, HubSpot, Resend or R2:
//   - prisma is a small stateful fake covering exactly the tables/methods
//     exportRun.ts (and, transitively, HubSpotClient's own portal lookup)
//     touches - see makeFakePrisma.
//   - HubSpotClient itself is the REAL class (not modified, not mocked) -
//     only global fetch is stubbed, so the real fetchRecords/resolveAssociations
//     wiring inside exportRun.ts is genuinely exercised.
//   - lib/export/writer.ts writes a REAL file to a real temp path (cleaned
//     up in afterEach) - same reasoning as tests/export/writer.test.ts: the
//     point is that the FILE is correct, not a mock of one.
//   - R2 upload is a global fetch stub matching the presigned URL's host.
//   - Resend is mocked at the module level (vi.mock('resend', ...)), tracking
//     raw call counts per idempotencyKey - "one email sent" is checked by
//     asserting the underlying send was invoked exactly once for that key,
//     or (for the retried-step case) that a retry reuses the SAME key, which
//     is the precondition for Resend's own dedup guarantee to hold - this
//     test cannot exercise Resend's server-side dedup itself.

const { resendSend, rawCallsByKey, lastPayloadByKey, resendState } = vi.hoisted(() => {
  const rawCallsByKey = new Map<string, number>();
  const lastPayloadByKey = new Map<string, unknown>();
  const resendState = { failNextCallsForKey: new Map<string, number>() };
  const resendSend = async (payload: unknown, options?: { idempotencyKey?: string }) => {
    const key = options?.idempotencyKey ?? '(no key)';
    rawCallsByKey.set(key, (rawCallsByKey.get(key) ?? 0) + 1);
    lastPayloadByKey.set(key, payload);

    const failsRemaining = resendState.failNextCallsForKey.get(key) ?? 0;
    if (failsRemaining > 0) {
      resendState.failNextCallsForKey.set(key, failsRemaining - 1);
      throw new Error('simulated Resend network failure');
    }
    return { data: { id: `email-${key}-${rawCallsByKey.get(key)}` }, error: null };
  };
  return { resendSend, rawCallsByKey, lastPayloadByKey, resendState };
});

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function FakeResend(this: { emails: { send: typeof resendSend } }) {
    this.emails = { send: resendSend };
  }),
}));

// A plain, mutable stand-in for the module - see setPrisma below. The real
// @/lib/db exports `prisma` as a `const`, whose ESM binding is read-only from
// an importer's perspective; this mock replaces the whole module with a
// plain object so individual tests can swap in their own fake per test.
vi.mock('@/lib/db', () => ({ prisma: undefined }));

const { exportRunHandler, exportRunOnFailure } = await import('@/inngest/exportRun');

const ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
const API_VERSION = '2026-03';

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

interface FakePortal {
  id: string;
  hubspotPortalId: bigint;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  tokenExpiresAt: Date;
  disconnectedAt: Date | null;
}
interface FakeExportDef {
  id: string;
  portalId: string;
  name: string;
  objectType: string;
  properties: string[];
  filters: unknown;
  associations: unknown;
  headerStyle: string;
  recipients: string[];
  scheduleCron: string | null;
  scheduleTz: string;
}
interface FakeExportRun {
  id: string;
  portalId: string;
  exportId: string;
  status: string;
  trigger: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  rowCount: number | null;
  fileKey: string | null;
  fileSizeBytes: number | null;
  apiCallCount: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

function makePortal(overrides: Partial<FakePortal> = {}): FakePortal {
  return {
    id: 'portal-1',
    hubspotPortalId: 123456789n,
    accessTokenEnc: encrypt('access-token'),
    refreshTokenEnc: encrypt('refresh-token'),
    tokenExpiresAt: new Date(Date.now() + 24 * 3600_000),
    disconnectedAt: null,
    ...overrides,
  };
}

function makeExportDef(overrides: Partial<FakeExportDef> = {}): FakeExportDef {
  return {
    id: 'export-1',
    portalId: 'portal-1',
    name: 'My Export',
    objectType: 'CONTACTS',
    properties: ['firstname'],
    filters: null,
    associations: null,
    headerStyle: 'LABEL',
    recipients: ['user@example.com'],
    scheduleCron: null,
    scheduleTz: 'UTC',
    ...overrides,
  };
}

function makeRun(overrides: Partial<FakeExportRun> = {}): FakeExportRun {
  return {
    id: 'run-1',
    portalId: 'portal-1',
    exportId: 'export-1',
    status: RunStatus.QUEUED,
    trigger: Trigger.MANUAL,
    startedAt: null,
    finishedAt: null,
    rowCount: null,
    fileKey: null,
    fileSizeBytes: null,
    apiCallCount: null,
    errorCode: null,
    errorMessage: null,
    ...overrides,
  };
}

type WhereStatus = string | { in: string[] } | undefined;
function statusMatches(actual: string, where: WhereStatus): boolean {
  if (!where) return true;
  if (typeof where === 'string') return actual === where;
  return where.in.includes(actual);
}

function makeFakePrisma(seed: { portal: FakePortal; exportDef: FakeExportDef; run: FakeExportRun; users?: { email: string }[] }) {
  let portal = { ...seed.portal };
  let exportDef = { ...seed.exportDef };
  const runs = new Map<string, FakeExportRun>([[seed.run.id, { ...seed.run }]]);
  const users = seed.users ?? [{ email: 'owner@example.com' }];

  return {
    exportRun: {
      findUnique: vi.fn(async ({ where: { id } }: { where: { id: string } }) => (runs.has(id) ? { ...runs.get(id)! } : null)),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status?: WhereStatus }; data: Partial<FakeExportRun> }) => {
        const run = runs.get(where.id);
        if (!run || !statusMatches(run.status, where.status)) return { count: 0 };
        runs.set(where.id, { ...run, ...data });
        return { count: 1 };
      }),
      update: vi.fn(async ({ where: { id }, data }: { where: { id: string }; data: Partial<FakeExportRun> }) => {
        const run = runs.get(id);
        if (!run) throw new Error('fake prisma: run not found');
        const updated = { ...run, ...data };
        runs.set(id, updated);
        return updated;
      }),
    },
    exportDefinition: {
      findUnique: vi.fn(async ({ where: { id } }: { where: { id: string } }) => (id === exportDef.id ? { ...exportDef } : null)),
      updateMany: vi.fn(async ({ where, data }: { where: { portalId: string }; data: Partial<FakeExportDef> }) => {
        if (where.portalId !== exportDef.portalId) return { count: 0 };
        exportDef = { ...exportDef, ...data };
        return { count: 1 };
      }),
    },
    portal: {
      findUnique: vi.fn(async ({ where: { id } }: { where: { id: string } }) => (id === portal.id ? { ...portal } : null)),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string; disconnectedAt?: null }; data: Partial<FakePortal> }) => {
          if (where.id !== portal.id) return { count: 0 };
          if ('disconnectedAt' in where && where.disconnectedAt === null && portal.disconnectedAt !== null) {
            return { count: 0 };
          }
          portal = { ...portal, ...data };
          return { count: 1 };
        },
      ),
    },
    user: {
      findMany: vi.fn(async () => users.map((u) => ({ ...u }))),
    },
    propertyCache: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
    },
    state: {
      get portal() {
        return portal;
      },
      get exportDef() {
        return exportDef;
      },
      runs,
    },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

async function setPrisma(fakePrisma: FakePrisma) {
  const dbModule = await import('@/lib/db');
  (dbModule as unknown as { prisma: FakePrisma }).prisma = fakePrisma;
}

function makeStep() {
  const cache = new Map<string, unknown>();
  return {
    cache,
    run: async <T>(idOrOptions: string | { id: string }, fn: () => T | Promise<T>) => {
      const id = typeof idOrOptions === 'string' ? idOrOptions : idOrOptions.id;
      if (cache.has(id)) return cache.get(id) as T;
      const result = await fn();
      cache.set(id, result);
      return result;
    },
  };
}

interface FakeHubSpotRecord {
  id: string;
  properties: Record<string, string | null>;
}

function makeFakeFetch(opts: {
  records?: FakeHubSpotRecord[];
  propertyDefs?: { name: string; label: string; type: string; fieldType: string }[];
  searchTotal?: number;
  onRequest?: (url: string, init: RequestInit | undefined) => Response | null;
}) {
  const records = opts.records ?? [];
  const propertyDefs = opts.propertyDefs ?? [{ name: 'firstname', label: 'First Name', type: 'string', fieldType: 'text' }];

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    const custom = opts.onRequest?.(url, init);
    if (custom) return custom;

    if (url.includes('/crm/properties/')) return jsonRes(200, { results: propertyDefs });
    if (url.includes('/crm/v3/owners')) return jsonRes(200, { results: [] });
    if (url.includes('.r2.cloudflarestorage.com')) return jsonRes(200, {});
    if (url.includes('/crm/objects/') && url.includes('/search')) {
      return jsonRes(200, { results: records, total: opts.searchTotal ?? records.length });
    }
    if (url.includes('/crm/objects/')) return jsonRes(200, { results: records });

    throw new Error(`unexpected fetch in test: ${init?.method ?? 'GET'} ${url}`);
  });
}

const tempFilesToClean: string[] = [];

beforeEach(() => {
  process.env.ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.HUBSPOT_API_VERSION = API_VERSION;
  process.env.HUBSPOT_CLIENT_ID = 'test-client-id';
  process.env.HUBSPOT_CLIENT_SECRET = 'test-client-secret';
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.R2_BUCKET = 'test-bucket';
  process.env.R2_OBJECT_KEY_SECRET = 'test-object-key-secret';
  process.env.RESEND_API_KEY = 'test-resend-key';
  rawCallsByKey.clear();
  lastPayloadByKey.clear();
  resendState.failNextCallsForKey.clear();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(tempFilesToClean.splice(0).map((p) => unlink(p).catch(() => undefined)));
});

const RUN_EVENT = { data: { exportRunId: 'run-1' } };

describe('exportRunHandler - requirement 1: idempotency', () => {
  it('running the handler twice for the same exportRunId sends one email, uploads once, transitions the run once', async () => {
    const fakePrisma = makeFakePrisma({ portal: makePortal(), exportDef: makeExportDef(), run: makeRun() });
    await setPrisma(fakePrisma);
    const fetchMock = makeFakeFetch({ records: [{ id: 'c1', properties: { firstname: 'Ada' } }] });
    vi.stubGlobal('fetch', fetchMock);
    tempFilesToClean.push(join(tmpdir(), 'cleanexport-run-run-1.xlsx'));

    const result1 = await exportRunHandler({ event: RUN_EVENT, step: makeStep() });
    expect(result1.rowCount).toBe(1);
    expect(fakePrisma.state.runs.get('run-1')!.status).toBe(RunStatus.SUCCESS);

    const uploadCallsAfterFirst = fetchMock.mock.calls.filter(([u]) => String(u).includes('r2.cloudflarestorage')).length;
    expect(uploadCallsAfterFirst).toBe(1);
    expect(rawCallsByKey.get('export-run-run-1')).toBe(1);

    // A second, INDEPENDENT invocation (fresh step cache - not a step retry)
    // for the SAME exportRunId: simulates a duplicate event delivery that
    // somehow reached the handler despite Inngest's own idempotency config.
    const result2 = await exportRunHandler({ event: RUN_EVENT, step: makeStep() });
    expect(result2.rowCount).toBe(1); // returns the already-recorded rowCount

    const uploadCallsAfterSecond = fetchMock.mock.calls.filter(([u]) => String(u).includes('r2.cloudflarestorage')).length;
    expect(uploadCallsAfterSecond).toBe(1); // unchanged - no second upload
    expect(rawCallsByKey.get('export-run-run-1')).toBe(1); // unchanged - no second email attempt
  });

  it('a transient failure sending the success email, then a retry, reuses the same idempotency key (Resend dedupes on it)', async () => {
    const fakePrisma = makeFakePrisma({ portal: makePortal(), exportDef: makeExportDef(), run: makeRun() });
    await setPrisma(fakePrisma);
    const fetchMock = makeFakeFetch({ records: [{ id: 'c1', properties: { firstname: 'Ada' } }] });
    vi.stubGlobal('fetch', fetchMock);
    tempFilesToClean.push(join(tmpdir(), 'cleanexport-run-run-1.xlsx'));

    resendState.failNextCallsForKey.set('export-run-run-1', 1); // first send attempt fails

    const step = makeStep(); // shared cache across both invocations - steps 1-3 memoize

    await expect(exportRunHandler({ event: RUN_EVENT, step })).rejects.toThrow('simulated Resend network failure');
    expect(rawCallsByKey.get('export-run-run-1')).toBe(1); // the failing attempt did reach Resend once

    const result = await exportRunHandler({ event: RUN_EVENT, step }); // retry: memoized steps 1-3 reused
    expect(result.rowCount).toBe(1);
    expect(rawCallsByKey.get('export-run-run-1')).toBe(2); // attempted twice ...
    // ... but both attempts used the exact same idempotency key, which is
    // Resend's own guarantee against a duplicate real delivery.
  });
});

describe('exportRunHandler - requirement 2: TOKEN_REVOKED', () => {
  it('a revoked grant fails the run with NonRetriableError, and onFailure marks it failed with a reconnect link', async () => {
    const fakePrisma = makeFakePrisma({
      portal: makePortal({ tokenExpiresAt: new Date(Date.now() + 60_000) }), // inside the 2h refresh margin
      exportDef: makeExportDef(),
      run: makeRun(),
    });
    await setPrisma(fakePrisma);

    const fetchMock = makeFakeFetch({
      records: [],
      onRequest: (url) => {
        if (url.includes('/oauth/v1/token')) {
          return jsonRes(400, { status: 'BAD_REFRESH_TOKEN', message: 'revoked by user' });
        }
        return null;
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    let caught: unknown;
    try {
      await exportRunHandler({ event: RUN_EVENT, step: makeStep() });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(NonRetriableError);
    expect((caught as Error).message).toContain('TOKEN_REVOKED');

    // disablePortalOnRevocation fires synchronously inside HubSpotClient's
    // refresh() via the onRevoked hook, independent of onFailure below.
    expect(fakePrisma.state.portal.disconnectedAt).not.toBeNull();
    expect(rawCallsByKey.get('portal-reconnect-portal-1')).toBe(1);

    await exportRunOnFailure({
      event: { data: { event: RUN_EVENT } },
      error: caught as Error,
      step: makeStep(),
    });

    expect(fakePrisma.state.runs.get('run-1')!.status).toBe(RunStatus.FAILED);
    expect(fakePrisma.state.runs.get('run-1')!.errorCode).toBe(ErrorCode.TOKEN_REVOKED);
    expect(rawCallsByKey.get('export-run-run-1-failed')).toBe(1);
    const payload = lastPayloadByKey.get('export-run-run-1-failed') as { html: string };
    expect(payload.html).toContain('Reconnect HubSpot');
  });

  it('never attempted a retry: NonRetriableError propagates immediately, not a generic retriable Error', async () => {
    const fakePrisma = makeFakePrisma({
      portal: makePortal({ tokenExpiresAt: new Date(Date.now() + 60_000) }),
      exportDef: makeExportDef(),
      run: makeRun(),
    });
    await setPrisma(fakePrisma);
    vi.stubGlobal(
      'fetch',
      makeFakeFetch({
        records: [],
        onRequest: (url) => (url.includes('/oauth/v1/token') ? jsonRes(400, { status: 'BAD_REFRESH_TOKEN' }) : null),
      }),
    );

    await expect(exportRunHandler({ event: RUN_EVENT, step: makeStep() })).rejects.toBeInstanceOf(NonRetriableError);
  });

  it('pins the bug: disablePortalOnRevocation guards the DB write, but the reconnect email is attempted on every call', async () => {
    const fakePrisma = makeFakePrisma({ portal: makePortal(), exportDef: makeExportDef(), run: makeRun() });
    await setPrisma(fakePrisma);

    const { disablePortalOnRevocation } = await import('@/inngest/revocation');

    await disablePortalOnRevocation('portal-1');
    const firstDisconnectedAt = fakePrisma.state.portal.disconnectedAt;
    expect(firstDisconnectedAt).not.toBeNull();
    expect(fakePrisma.exportDefinition.updateMany).toHaveBeenCalledTimes(1);
    expect(rawCallsByKey.get('portal-reconnect-portal-1')).toBe(1);

    // Second call: e.g. a retry after the DB write succeeded but the first
    // email send failed to complete, or a second concurrent caller. The CAS
    // on disconnectedAt correctly makes the DB write a no-op the second time...
    await disablePortalOnRevocation('portal-1');
    expect(fakePrisma.state.portal.disconnectedAt).toEqual(firstDisconnectedAt);
    expect(fakePrisma.exportDefinition.updateMany).toHaveBeenCalledTimes(1); // still just once

    // ...but the email must STILL be attempted. An earlier draft folded the
    // email into the same "only the CAS winner acts" guard, which meant this
    // second call would skip the email forever - exactly the silent failure
    // this function exists to prevent.
    expect(rawCallsByKey.get('portal-reconnect-portal-1')).toBe(2);
  });
});

describe('exportRunHandler - requirement 3: SEARCH_CAP_EXCEEDED and TIMEOUT', () => {
  it('SEARCH_CAP_EXCEEDED: the run is marked FAILED with that errorCode, and the failure email reaches the recipients', async () => {
    const fakePrisma = makeFakePrisma({
      portal: makePortal(),
      exportDef: makeExportDef({ filters: { operator: 'AND', conditions: [{ property: 'email', operator: 'HAS_PROPERTY' }] } }),
      run: makeRun(),
    });
    await setPrisma(fakePrisma);
    vi.stubGlobal('fetch', makeFakeFetch({ records: [{ id: 'c1', properties: { firstname: 'Ada' } }], searchTotal: 10000 }));

    let caught: unknown;
    try {
      await exportRunHandler({ event: RUN_EVENT, step: makeStep() });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NonRetriableError);
    expect((caught as Error).message).toContain('SEARCH_CAP_EXCEEDED');

    await exportRunOnFailure({ event: { data: { event: RUN_EVENT } }, error: caught as Error, step: makeStep() });

    expect(fakePrisma.state.runs.get('run-1')!.status).toBe(RunStatus.FAILED);
    expect(fakePrisma.state.runs.get('run-1')!.errorCode).toBe(ErrorCode.SEARCH_CAP_EXCEEDED);
    expect(rawCallsByKey.get('export-run-run-1-failed')).toBe(1);
    const payload = lastPayloadByKey.get('export-run-run-1-failed') as { to: string[] };
    expect(payload.to).toEqual(['user@example.com']); // the export's own recipients
  });

  it('TIMEOUT: a run exceeding 30 minutes is marked FAILED with TIMEOUT, and the email reaches the recipients', async () => {
    const fakePrisma = makeFakePrisma({ portal: makePortal(), exportDef: makeExportDef(), run: makeRun() });
    await setPrisma(fakePrisma);

    // A controllable fake clock: Date.now() is mocked globally (HubSpotClient's
    // own token-expiry check and rate limiter also call Date.now(), so a
    // simple sequential mockReturnValueOnce chain gets consumed out of order
    // by those unrelated calls). Instead, the SECOND page's fetch response
    // itself advances the clock past the 30-minute limit as a side effect,
    // right before the loop's own elapsed-time check runs against it.
    const fakeClock = { now: Date.now() };
    const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => fakeClock.now);

    vi.stubGlobal(
      'fetch',
      makeFakeFetch({
        records: [{ id: 'c1', properties: { firstname: 'Ada' } }],
        onRequest: (url) => {
          if (url.includes('/crm/objects/') && !url.includes('/search')) {
            const afterCursor = new URL(url).searchParams.get('after');
            if (!afterCursor) {
              return jsonRes(200, { results: [{ id: 'c1', properties: { firstname: 'Ada' } }], paging: { next: { after: 'cursor-2' } } });
            }
            fakeClock.now += 31 * 60_000; // simulate 31 minutes elapsing before page 2 arrives
            return jsonRes(200, { results: [{ id: 'c2', properties: { firstname: 'Grace' } }] });
          }
          return null;
        },
      }),
    );

    let caught: unknown;
    try {
      await exportRunHandler({ event: RUN_EVENT, step: makeStep() });
    } catch (err) {
      caught = err;
    }
    dateSpy.mockRestore();

    expect(caught).toBeInstanceOf(NonRetriableError);
    expect((caught as Error).message).toContain('TIMEOUT');

    await exportRunOnFailure({ event: { data: { event: RUN_EVENT } }, error: caught as Error, step: makeStep() });

    expect(fakePrisma.state.runs.get('run-1')!.status).toBe(RunStatus.FAILED);
    expect(fakePrisma.state.runs.get('run-1')!.errorCode).toBe(ErrorCode.TIMEOUT);
    expect(rawCallsByKey.get('export-run-run-1-failed')).toBe(1);
  });
});

describe('exportRunHandler - requirement 4: zero rows still produces and emails a headers-only file', () => {
  it('an empty result set still writes and emails a file, saying "0 records matched" - never a silent no-op', async () => {
    const fakePrisma = makeFakePrisma({ portal: makePortal(), exportDef: makeExportDef(), run: makeRun() });
    await setPrisma(fakePrisma);
    vi.stubGlobal('fetch', makeFakeFetch({ records: [] }));
    tempFilesToClean.push(join(tmpdir(), 'cleanexport-run-run-1.xlsx'));

    const result = await exportRunHandler({ event: RUN_EVENT, step: makeStep() });

    expect(result.rowCount).toBe(0);
    expect(fakePrisma.state.runs.get('run-1')!.status).toBe(RunStatus.SUCCESS);
    expect(fakePrisma.state.runs.get('run-1')!.rowCount).toBe(0);

    expect(rawCallsByKey.get('export-run-run-1')).toBe(1); // not skipped
    const payload = lastPayloadByKey.get('export-run-run-1') as { html: string };
    expect(payload.html).toContain('0 records matched');
  });
});

describe('exportRunHandler - requirement 5: NO_RECIPIENTS', () => {
  it('an export with no recipients fails the run with NO_RECIPIENTS rather than succeeding silently', async () => {
    const fakePrisma = makeFakePrisma({
      portal: makePortal(),
      exportDef: makeExportDef({ recipients: [] }),
      run: makeRun(),
    });
    await setPrisma(fakePrisma);
    vi.stubGlobal('fetch', makeFakeFetch({ records: [{ id: 'c1', properties: { firstname: 'Ada' } }] }));

    let caught: unknown;
    try {
      await exportRunHandler({ event: RUN_EVENT, step: makeStep() });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(NonRetriableError);
    expect((caught as Error).message).toContain(ErrorCode.NO_RECIPIENTS);

    // Never reached the HubSpot API, the upload, or a success email - it
    // fails before any of that work, not after generating a file nobody
    // will receive.
    expect(rawCallsByKey.size).toBe(0);

    await exportRunOnFailure({
      event: { data: { event: RUN_EVENT } },
      error: caught as Error,
      step: makeStep(),
    });

    expect(fakePrisma.state.runs.get('run-1')!.status).toBe(RunStatus.FAILED);
    expect(fakePrisma.state.runs.get('run-1')!.errorCode).toBe(ErrorCode.NO_RECIPIENTS);
  });

  it('an export WITH recipients actually calls the email step with a non-empty list', async () => {
    const fakePrisma = makeFakePrisma({
      portal: makePortal(),
      exportDef: makeExportDef({ recipients: ['ada@example.com', 'grace@example.com'] }),
      run: makeRun(),
    });
    await setPrisma(fakePrisma);
    vi.stubGlobal('fetch', makeFakeFetch({ records: [{ id: 'c1', properties: { firstname: 'Ada' } }] }));
    tempFilesToClean.push(join(tmpdir(), 'cleanexport-run-run-1.xlsx'));

    await exportRunHandler({ event: RUN_EVENT, step: makeStep() });

    expect(rawCallsByKey.get('export-run-run-1')).toBe(1);
    const payload = lastPayloadByKey.get('export-run-run-1') as { to: string[] };
    expect(payload.to).toEqual(['ada@example.com', 'grace@example.com']);
  });
});

describe('inngest/email.ts sendSuccessEmail - requirement 6: the 8 MB attachment rule', () => {
  it('a file at or under 8 MB is attached AND linked', async () => {
    const { sendSuccessEmail } = await import('@/inngest/email');
    const filePath = join(tmpdir(), 'cleanexport-8mb-test-small.xlsx');
    await writeFile(filePath, 'not actually a real xlsx, just needs to exist');
    tempFilesToClean.push(filePath);

    rawCallsByKey.delete('under-8mb');
    await sendSuccessEmail({
      recipients: ['user@example.com'],
      idempotencyKey: 'under-8mb',
      exportName: 'Small Export',
      rowCount: 10,
      downloadUrl: 'https://example.com/download',
      skippedColumns: [],
      filePath,
      fileSizeBytes: 8 * 1024 * 1024, // exactly at the threshold
    });

    const payload = lastPayloadByKey.get('under-8mb') as { attachments?: unknown[]; html: string };
    expect(payload.attachments).toHaveLength(1);
    expect(payload.html).toContain('https://example.com/download');
    expect(payload.html).not.toContain('too large to attach');
  });

  it('a file over 8 MB is link-only, with the size stated in the body', async () => {
    const { sendSuccessEmail } = await import('@/inngest/email');

    rawCallsByKey.delete('over-8mb');
    await sendSuccessEmail({
      recipients: ['user@example.com'],
      idempotencyKey: 'over-8mb',
      exportName: 'Big Export',
      rowCount: 500_000,
      downloadUrl: 'https://example.com/download-big',
      skippedColumns: [],
      // no filePath needed - attachEligible short-circuits to false before it
      // would ever be read.
      fileSizeBytes: 9 * 1024 * 1024,
    });

    const payload = lastPayloadByKey.get('over-8mb') as { attachments?: unknown[]; html: string };
    expect(payload.attachments).toBeUndefined();
    expect(payload.html).toContain('https://example.com/download-big');
    expect(payload.html).toContain('too large to attach');
    expect(payload.html).toContain('9.0 MB');
  });
});

// specs/07-TASKS.md T22, THE TEST THAT MATTERS #2: "a test that captures
// logger output during an export run with a known token value and asserts
// that value never appears." This runs the REAL exportRunHandler/
// exportRunOnFailure (not a mock of them) against a portal whose
// accessTokenEnc/refreshTokenEnc decrypt to two distinctive, known-in-advance
// plaintext strings, spies on every console method lib/logger.ts can write
// to, and asserts neither string appears in ANY captured call - not just the
// lines this file's own logger.info/logger.error calls happen to produce
// today. If a future change ever logged the portal row or the HubSpot client
// wholesale, this is what would catch it.
describe('THE TEST THAT MATTERS - no decrypted token ever reaches a log line', () => {
  const KNOWN_ACCESS_TOKEN = 'KNOWN-SECRET-ACCESS-TOKEN-9f3e7b1c';
  const KNOWN_REFRESH_TOKEN = 'KNOWN-SECRET-REFRESH-TOKEN-2a8d4f60';

  function spyOnConsole() {
    return {
      log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    };
  }

  function assertNoTokenLeak(spies: ReturnType<typeof spyOnConsole>) {
    let inspected = 0;
    for (const spy of Object.values(spies)) {
      for (const call of spy.mock.calls) {
        inspected++;
        const text = call.map((arg) => String(arg)).join(' ');
        expect(text).not.toContain(KNOWN_ACCESS_TOKEN);
        expect(text).not.toContain(KNOWN_REFRESH_TOKEN);
      }
    }
    return inspected;
  }

  it('a successful run never logs the decrypted access or refresh token', async () => {
    process.env.LOG_LEVEL = 'debug';
    const fakePrisma = makeFakePrisma({
      portal: makePortal({
        accessTokenEnc: encrypt(KNOWN_ACCESS_TOKEN),
        refreshTokenEnc: encrypt(KNOWN_REFRESH_TOKEN),
      }),
      exportDef: makeExportDef(),
      run: makeRun(),
    });
    await setPrisma(fakePrisma);
    vi.stubGlobal('fetch', makeFakeFetch({ records: [{ id: 'c1', properties: { firstname: 'Ada' } }] }));
    tempFilesToClean.push(join(tmpdir(), 'cleanexport-run-run-1.xlsx'));

    const spies = spyOnConsole();
    const result = await exportRunHandler({ event: RUN_EVENT, step: makeStep() });

    expect(result.rowCount).toBe(1); // the run genuinely completed - this isn't a test that skipped the pipeline
    const inspected = assertNoTokenLeak(spies);
    expect(inspected).toBeGreaterThan(0); // and it DID log something - a vacuous pass (no log lines at all) would prove nothing
  });

  it('a failed run - through mark-failed, the failure email, and onFailure - never logs either token', async () => {
    process.env.LOG_LEVEL = 'debug';
    const fakePrisma = makeFakePrisma({
      portal: makePortal({
        accessTokenEnc: encrypt(KNOWN_ACCESS_TOKEN),
        refreshTokenEnc: encrypt(KNOWN_REFRESH_TOKEN),
        tokenExpiresAt: new Date(Date.now() + 60_000), // inside the refresh margin - forces a refresh attempt using the known refresh token
      }),
      exportDef: makeExportDef(),
      run: makeRun(),
    });
    await setPrisma(fakePrisma);
    vi.stubGlobal(
      'fetch',
      makeFakeFetch({
        records: [],
        onRequest: (url) => (url.includes('/oauth/v1/token') ? jsonRes(400, { status: 'BAD_REFRESH_TOKEN', message: 'revoked' }) : null),
      }),
    );

    const spies = spyOnConsole();
    let caught: unknown;
    try {
      await exportRunHandler({ event: RUN_EVENT, step: makeStep() });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NonRetriableError); // confirms the refresh/revocation path actually ran

    await exportRunOnFailure({ event: { data: { event: RUN_EVENT } }, error: caught as Error, step: makeStep() });

    assertNoTokenLeak(spies);
  });
});
