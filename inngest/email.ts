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
 */

import { Resend } from 'resend';
import { readFile } from 'node:fs/promises';

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // spec section 9

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

/** The dashboard prompts a fresh OAuth connect when the portal is disconnected. */
export function buildReconnectUrl(): string {
  const base = process.env.APP_URL ?? 'http://localhost:3000';
  return `${base}/dashboard`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:sans-serif;color:#1a1a1a;line-height:1.5">
<h2 style="margin:0 0 16px">${escapeHtml(title)}</h2>
${bodyHtml}
<p style="margin-top:32px;color:#666;font-size:12px">CleanExport</p>
</body></html>`;
}

export interface SuccessEmailInput {
  recipients: string[];
  idempotencyKey: string;
  exportName: string;
  rowCount: number;
  downloadUrl: string;
  skippedColumns: string[];
  filePath?: string;
  fileSizeBytes: number;
}

export async function sendSuccessEmail(input: SuccessEmailInput): Promise<void> {
  if (input.recipients.length === 0) return;

  const zeroRowsNotice =
    input.rowCount === 0
      ? '<p><strong>0 records matched.</strong> The file still has headers - your filters may be too narrow.</p>'
      : `<p>${input.rowCount.toLocaleString()} record${input.rowCount === 1 ? '' : 's'} exported.</p>`;

  const skippedNotice = input.skippedColumns.length
    ? `<p>These columns no longer exist in your HubSpot portal and were skipped: ${escapeHtml(
        input.skippedColumns.join(', '),
      )}.</p>`
    : '';

  const attachEligible = input.fileSizeBytes <= MAX_ATTACHMENT_BYTES && input.filePath;
  const sizeNotice = attachEligible
    ? ''
    : `<p>The file is ${(input.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB - too large to attach, so it is link-only below.</p>`;

  const html = layout(
    `${input.exportName} is ready`,
    `${zeroRowsNotice}${skippedNotice}${sizeNotice}<p><a href="${input.downloadUrl}">Download the file</a> (link expires in 7 days).</p>`,
  );

  await client().emails.send(
    {
      from: fromAddress(),
      to: input.recipients,
      subject: `${input.exportName} is ready`,
      html,
      attachments: attachEligible ? [{ filename: attachmentFilename(input.exportName), content: await readFile(input.filePath!) }] : undefined,
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

function attachmentFilename(exportName: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${slugify(exportName)}_${date}.xlsx`;
}

export interface FailureEmailInput {
  recipients: string[];
  idempotencyKey: string;
  exportName: string;
  errorCode: string;
  errorMessage: string;
  reconnectUrl?: string;
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
  const reconnectCta = input.reconnectUrl
    ? `<p><a href="${input.reconnectUrl}">Reconnect HubSpot</a></p>`
    : '';

  const html = layout(`${input.exportName} failed`, `<p>${escapeHtml(advice)}</p>${reconnectCta}`);

  await client().emails.send(
    {
      from: fromAddress(),
      to: input.recipients,
      subject: `${input.exportName} failed`,
      html,
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
 */
export async function sendReconnectEmail(input: ReconnectEmailInput): Promise<void> {
  if (input.recipients.length === 0) return;

  const html = layout(
    'Reconnect HubSpot',
    `<p>Your HubSpot connection was disconnected (access was revoked), so all scheduled exports for this portal have been paused.</p>` +
      `<p><a href="${input.reconnectUrl}">Reconnect HubSpot</a> to resume them.</p>`,
  );

  await client().emails.send(
    {
      from: fromAddress(),
      to: input.recipients,
      subject: 'Reconnect HubSpot to resume your CleanExport schedules',
      html,
    },
    { idempotencyKey: input.idempotencyKey },
  );
}
