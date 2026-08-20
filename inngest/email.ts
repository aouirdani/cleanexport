/**
 * Export-run emails via Resend - specs/05-EXPORT-ENGINE.md section 8:
 * "Every failure sends an email to the export's recipients. A scheduled
 * export that fails silently is worse than no scheduled export."
 *
 * Idempotency: every send passes `idempotencyKey` (Resend's `Idempotency-Key`
 * header - see node_modules/resend's CreateEmailRequestOptions). If an
 * Inngest step that already sent an email is retried (e.g. the send
 * succeeded but the confirmation was lost), the retried call reuses the same
 * key instead of creating a second email.
 *
 * Defect #3 ("the emails are unreadable"): every send here carries both
 * `html` and `text` - Resend does not synthesize a plain-text part from HTML
 * on its own, so before this there wasn't one at all; a client that
 * preferred/fell back to plain text got nothing, or (depending on the
 * client's own HTML-to-text fallback) a naive tag-strip that dumped a raw,
 * unwrapped URL inline. `wrapParagraph` wraps prose at 78 characters for the
 * text part - a bare URL is a single unbreakable "word" and is deliberately
 * left as its own line rather than split.
 */

import { Resend } from 'resend';
import { readFile } from 'node:fs/promises';

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // spec section 9
const TEXT_WRAP_WIDTH = 78;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function client(): Resend {
  return new Resend(requireEnv('RESEND_API_KEY'));
}

function fromAddress(): string {
  return process.env.EMAIL_FROM ?? 'CleanExport <exports@cleanexport.app>';
}

function appUrl(): string {
  return process.env.APP_URL ?? 'http://localhost:3000';
}

/** The dashboard prompts a fresh OAuth connect when the portal is disconnected. */
export function buildReconnectUrl(): string {
  return `${appUrl()}/dashboard`;
}

/**
 * Defect #2: the success email used to link straight to a presigned R2 URL
 * - a customer's browser opened a blank tab first (R2 serves the object
 * with no Content-Disposition of its own), and the link exposed the
 * storage backend's hostname and an X-Amz-Credential query param besides.
 * app/api/runs/[id]/download/route.ts already exists, is portal-scoped and
 * tested, and re-signs a fresh R2 URL (this time WITH a Content-Disposition
 * - see inngest/r2.ts's signedDownloadUrl) on every request rather than
 * embedding one that can go stale - so the email links here instead, a
 * short, readable, never-expiring-on-its-own-face URL.
 */
export function buildRunDownloadUrl(exportRunId: string): string {
  return `${appUrl()}/api/runs/${exportRunId}/download`;
}

/** specs/07-TASKS.md T19's filtered run-history view - "a link back to the run" (defect #3). */
export function buildRunHistoryUrl(exportId: string): string {
  return `${appUrl()}/dashboard/runs?exportId=${exportId}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Day-month(-year), always in a fixed order ("20 Aug", never "Aug 20") and a
 * fixed timezone (UTC) regardless of server locale/TZ - built from the raw
 * UTC fields rather than `Intl.DateTimeFormat`'s locale-dependent field
 * order, which for en-US puts the month first.
 */
function shortDate(date: Date, includeYear = false): string {
  const day = date.getUTCDate();
  const month = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short' }).format(date);
  return includeYear ? `${day} ${month} ${date.getUTCFullYear()}` : `${day} ${month}`;
}

/**
 * Greedy word-wrap for the plain-text part - defect #3: "the plain-text part
 * must wrap at 78 characters." A single "word" longer than the width (a bare
 * URL, most often) is left on its own line rather than broken - breaking a
 * URL mid-string would make it unusable.
 */
function wrapParagraph(text: string, width = TEXT_WRAP_WIDTH): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line.length === 0) {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line += ` ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

function plainTextBody(paragraphs: string[]): string {
  return paragraphs
    .filter((p) => p.length > 0)
    .map((p) => wrapParagraph(p))
    .join('\n\n');
}

/**
 * Quiet, minimal layout shared by every email here: no emoji, no marketing
 * tone, no unsubscribe footer (this is transactional mail, not a newsletter)
 * - just a title, the body, and a small signature line.
 */
function htmlLayout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:sans-serif;color:#1a1a1a;line-height:1.5">
<h2 style="margin:0 0 16px">${escapeHtml(title)}</h2>
${bodyHtml}
<p style="margin-top:32px;color:#666;font-size:12px">CleanExport</p>
</body></html>`;
}

function paragraphsToHtml(paragraphs: string[]): string {
  return paragraphs
    .filter((p) => p.length > 0)
    .map((p) => `<p>${p}</p>`)
    .join('\n');
}

export interface SuccessEmailInput {
  recipients: string[];
  idempotencyKey: string;
  exportName: string;
  /** Display label, e.g. "Contacts" - not the raw ObjectType enum value. */
  objectTypeLabel: string;
  /** Portal.hubDomain - null is possible (HubSpot didn't return one yet); a customer with two portals must be able to tell them apart. */
  portalDomain: string | null;
  rowCount: number;
  downloadUrl: string;
  /** A link back to this run in the dashboard's run history. */
  runUrl: string;
  /** The signed download link's real expiry - shown as a date, never "in 7 days" (defect #3). */
  expiresAt: Date;
  skippedColumns: string[];
  filePath?: string;
  fileSizeBytes: number;
  /** The moment this run finished - drives the subject's date. A parameter, not read internally, so this stays a pure function of its inputs. */
  date: Date;
}

export async function sendSuccessEmail(input: SuccessEmailInput): Promise<void> {
  if (input.recipients.length === 0) return;

  const portalPhrase = input.portalDomain ? `from ${input.portalDomain}` : 'from your HubSpot portal';
  const rowsFormatted = input.rowCount.toLocaleString('en-US');

  // specs/05-EXPORT-ENGINE.md section 8: "Email says '0 records matched'" -
  // that exact phrase, not a paraphrase.
  const summaryHtml =
    input.rowCount === 0
      ? `<strong>${escapeHtml(input.exportName)}</strong> (${escapeHtml(input.objectTypeLabel)}) ${escapeHtml(portalPhrase)}: 0 records matched. The file still has headers - your filters may be too narrow.`
      : `<strong>${escapeHtml(input.exportName)}</strong> (${escapeHtml(input.objectTypeLabel)}) exported ${rowsFormatted} row${input.rowCount === 1 ? '' : 's'} ${escapeHtml(portalPhrase)}.`;
  const summaryText =
    input.rowCount === 0
      ? `${input.exportName} (${input.objectTypeLabel}) ${portalPhrase}: 0 records matched. The file still has headers - your filters may be too narrow.`
      : `${input.exportName} (${input.objectTypeLabel}) exported ${rowsFormatted} row${input.rowCount === 1 ? '' : 's'} ${portalPhrase}.`;

  const attachEligible = input.fileSizeBytes <= MAX_ATTACHMENT_BYTES && Boolean(input.filePath);
  const fileMb = (input.fileSizeBytes / (1024 * 1024)).toFixed(1);
  const fileHtml = attachEligible
    ? 'The file is attached, and also available at the link below.'
    : `The file is ${fileMb} MB - too large to attach, so it is available at the link below.`;
  const fileText = fileHtml;

  const downloadHtml = `<a href="${input.downloadUrl}">Download the file</a>`;
  const downloadText = `Download the file: ${input.downloadUrl}`;

  const expiryHtml = `This link expires on ${shortDate(input.expiresAt, true)}.`;
  const expiryText = expiryHtml;

  const skippedHtml = input.skippedColumns.length
    ? `These columns no longer exist in your HubSpot portal and were skipped: ${escapeHtml(input.skippedColumns.join(', '))}.`
    : '';
  const skippedText = input.skippedColumns.length
    ? `These columns no longer exist in your HubSpot portal and were skipped: ${input.skippedColumns.join(', ')}.`
    : '';

  const runLinkHtml = `<a href="${input.runUrl}">View this run</a>`;
  const runLinkText = `View this run: ${input.runUrl}`;

  const subject = `${input.exportName} — ${rowsFormatted} row${input.rowCount === 1 ? '' : 's'} — ${shortDate(input.date)}`;

  const html = htmlLayout(
    subject,
    paragraphsToHtml([summaryHtml, fileHtml, downloadHtml, expiryHtml, skippedHtml, runLinkHtml]),
  );
  const text = plainTextBody([summaryText, fileText, downloadText, expiryText, skippedText, runLinkText]);

  await client().emails.send(
    {
      from: fromAddress(),
      to: input.recipients,
      subject,
      html,
      text,
      attachments: attachEligible
        ? [{ filename: exportFilename(input.exportName, input.date), content: await readFile(input.filePath!) }]
        : undefined,
    },
    { idempotencyKey: input.idempotencyKey },
  );
}

/**
 * specs/05-EXPORT-ENGINE.md section 9: "Filename: {export-name}_{YYYY-MM-DD}.xlsx,
 * slugified, no spaces." NFKD-normalising and stripping the resulting
 * combining marks turns "Départ â€" into "depart" instead of collapsing every
 * accented letter straight to a dash (which `é` etc. would do if this
 * ran the [^a-z0-9]+ collapse alone) - an accented export name should not
 * come out as an unreadable string of hyphens.
 */
const COMBINING_DIACRITICS = /[̀-ͯ]/g;

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(COMBINING_DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The one place that builds the `{export-name}_{YYYY-MM-DD}.xlsx` filename
 * (spec section 9) - shared by the attachment built here AND
 * app/api/runs/[id]/download/route.ts's Content-Disposition (defect #2),
 * so a file downloaded from the email attachment and one downloaded later
 * from the dashboard/re-signed link have the exact same name. `date` is a
 * parameter, not read internally, so both callers can be explicit about
 * which date they mean (generation time here; the run's own finishedAt for
 * a link clicked well after the email was sent).
 */
export function exportFilename(exportName: string, date: Date): string {
  return `${slugify(exportName)}_${date.toISOString().slice(0, 10)}.xlsx`;
}

export interface FailureEmailInput {
  recipients: string[];
  idempotencyKey: string;
  exportName: string;
  errorCode: string;
  errorMessage: string;
  /** A link back to this run in the dashboard's run history (defect #3). */
  runUrl: string;
  reconnectUrl?: string;
  /** The moment this run failed - drives the subject's date. */
  date: Date;
}

const FAILURE_ADVICE: Record<string, string> = {
  TOKEN_REVOKED:
    'Your HubSpot connection was disconnected, so scheduled exports for this portal have been paused. Reconnect to resume them.',
  SEARCH_CAP_EXCEEDED:
    'Your filters matched more than HubSpot allows a single search to return. Add a narrower filter (for example a shorter date range) and try again.',
  RATE_LIMITED: 'HubSpot rate-limited this portal even after retrying. Try running the export again shortly.',
  TIMEOUT: 'This export took longer than 30 minutes. Try narrowing it with a filter, or splitting it into smaller exports.',
};

/**
 * specs/05-EXPORT-ENGINE.md section 8: "the failure body names the error in
 * plain language, never a stack trace or an error code the customer cannot
 * act on." `input.errorMessage` (the classified error's raw `.message` -
 * see inngest/exportRun.ts's classifyFailure) is deliberately NOT rendered
 * here, in any form: it's an internal detail for the ExportRun row and
 * whoever reads Sentry, not customer-facing copy. An earlier draft included
 * it in a muted paragraph below the advice line "for context" - but for the
 * unmapped/generic failure path that message is whatever `err.message`
 * happened to be (could be anything a bug throws), which is exactly the
 * "error the customer cannot act on" the spec forbids. FAILURE_ADVICE's
 * fallback string is the only thing shown for an unmapped code.
 */
export async function sendFailureEmail(input: FailureEmailInput): Promise<void> {
  if (input.recipients.length === 0) return;

  const advice = FAILURE_ADVICE[input.errorCode] ?? 'Something went wrong while building your export. Our team has been notified.';
  const runLinkHtml = `<a href="${input.runUrl}">View this run</a>`;
  const runLinkText = `View this run: ${input.runUrl}`;
  const reconnectHtml = input.reconnectUrl ? `<a href="${input.reconnectUrl}">Reconnect HubSpot</a>` : '';
  const reconnectText = input.reconnectUrl ? `Reconnect HubSpot: ${input.reconnectUrl}` : '';

  const subject = `${input.exportName} did not run — ${shortDate(input.date)}`;

  const html = htmlLayout(subject, paragraphsToHtml([escapeHtml(advice), runLinkHtml, reconnectHtml]));
  const text = plainTextBody([advice, runLinkText, reconnectText]);

  await client().emails.send(
    {
      from: fromAddress(),
      to: input.recipients,
      subject,
      html,
      text,
    },
    { idempotencyKey: input.idempotencyKey },
  );
}

export interface ReconnectEmailInput {
  recipients: string[];
  idempotencyKey: string;
  reconnectUrl: string;
}

/**
 * specs/04-HUBSPOT-INTEGRATION.md section 2: "email the user with a
 * reconnect link" - sent once per portal disconnection, to the portal's
 * users (not a specific export's recipients, since this isn't about any one
 * export - see inngest/revocation.ts).
 *
 * Defect #3: "the most urgent" of the three - order matters. Say the
 * exports have STOPPED first (the thing the customer actually feels),
 * THEN why, THEN what to do about it - not "your connection was revoked"
 * leading, which reads like a status update rather than the actionable
 * problem it is.
 */
export async function sendReconnectEmail(input: ReconnectEmailInput): Promise<void> {
  if (input.recipients.length === 0) return;

  const subject = 'Your CleanExport schedules have stopped';
  const stoppedHtml = 'Your scheduled exports have stopped running.';
  const whyHtml = 'This is because your HubSpot connection was disconnected (access was revoked).';
  const reconnectHtml = `<a href="${input.reconnectUrl}">Reconnect HubSpot</a> to resume them.`;
  const reconnectText = `Reconnect HubSpot to resume them: ${input.reconnectUrl}`;

  const html = htmlLayout(subject, paragraphsToHtml([stoppedHtml, whyHtml, reconnectHtml]));
  const text = plainTextBody([stoppedHtml, whyHtml, reconnectText]);

  await client().emails.send(
    {
      from: fromAddress(),
      to: input.recipients,
      subject,
      html,
      text,
    },
    { idempotencyKey: input.idempotencyKey },
  );
}
