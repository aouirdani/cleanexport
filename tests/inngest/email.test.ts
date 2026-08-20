import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// inngest/email.ts - specs/05-EXPORT-ENGINE.md section 9 (delivery rules)
// and section 8 (failure handling). Resend is mocked at the module level,
// same pattern as tests/inngest/exportRun.test.ts.

const { resendSend, lastPayloadByKey } = vi.hoisted(() => {
  const lastPayloadByKey = new Map<string, unknown>();
  const resendSend = async (payload: unknown, options?: { idempotencyKey?: string }) => {
    lastPayloadByKey.set(options?.idempotencyKey ?? '(no key)', payload);
    return { data: { id: 'email-1' }, error: null };
  };
  return { resendSend, lastPayloadByKey };
});

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(function FakeResend(this: { emails: { send: typeof resendSend } }) {
    this.emails = { send: resendSend };
  }),
}));

const { slugify, sendSuccessEmail, sendFailureEmail, sendReconnectEmail, exportFilename, buildRunDownloadUrl } =
  await import('@/inngest/email');

beforeEach(() => {
  process.env.RESEND_API_KEY = 'test-resend-key';
  lastPayloadByKey.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('slugify - specs/05-EXPORT-ENGINE.md section 9: filename slugification', () => {
  it('replaces spaces with hyphens', () => {
    expect(slugify('My Weekly Export')).toBe('my-weekly-export');
  });

  it('collapses runs of whitespace and punctuation into a single hyphen', () => {
    expect(slugify('Q1  --  Deals!!')).toBe('q1-deals');
  });

  it('transliterates accented characters instead of dropping them into a bare hyphen', () => {
    expect(slugify('Départ Clients')).toBe('depart-clients');
    expect(slugify('Ventes Été 2026')).toBe('ventes-ete-2026');
    expect(slugify('Ünïcödé Ñame')).toBe('unicode-name');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  Leading and trailing  ')).toBe('leading-and-trailing');
    expect(slugify('!!!Wrapped!!!')).toBe('wrapped');
  });

  it('lowercases mixed-case names', () => {
    expect(slugify('ALLCAPS Export')).toBe('allcaps-export');
  });

  it('produces no spaces in the output at all', () => {
    expect(slugify('a b c d e')).not.toMatch(/\s/);
  });
});

describe('sendSuccessEmail - attachment filename uses the slugified export name and today\'s date', () => {
  it('applies the {export-name}_{YYYY-MM-DD}.xlsx pattern to an accented, spaced export name', async () => {
    const filePath = join(tmpdir(), 'cleanexport-filename-test.xlsx');
    await writeFile(filePath, 'placeholder');

    try {
      await sendSuccessEmail({
        recipients: ['user@example.com'],
        idempotencyKey: 'filename-test',
        exportName: 'Départ Clients Été',
        rowCount: 5,
        downloadUrl: 'https://example.com/download',
        skippedColumns: [],
        filePath,
        fileSizeBytes: 1024,
      });
    } finally {
      await unlink(filePath).catch(() => undefined);
    }

    const payload = lastPayloadByKey.get('filename-test') as { attachments: { filename: string }[] };
    const today = new Date().toISOString().slice(0, 10);
    expect(payload.attachments[0].filename).toBe(`depart-clients-ete_${today}.xlsx`);
    expect(payload.attachments[0].filename).not.toMatch(/\s/);
  });
});

describe('sendSuccessEmail - skipped columns (specs/05-EXPORT-ENGINE.md section 8)', () => {
  it('lists skipped columns in the body when properties no longer exist in the portal', async () => {
    await sendSuccessEmail({
      recipients: ['user@example.com'],
      idempotencyKey: 'skipped-cols',
      exportName: 'My Export',
      rowCount: 10,
      downloadUrl: 'https://example.com/download',
      skippedColumns: ['old_property', 'another_removed_field'],
      fileSizeBytes: 1024,
    });

    const payload = lastPayloadByKey.get('skipped-cols') as { html: string };
    expect(payload.html).toContain('old_property');
    expect(payload.html).toContain('another_removed_field');
  });

  it('says nothing about skipped columns when none were skipped', async () => {
    await sendSuccessEmail({
      recipients: ['user@example.com'],
      idempotencyKey: 'no-skipped-cols',
      exportName: 'My Export',
      rowCount: 10,
      downloadUrl: 'https://example.com/download',
      skippedColumns: [],
      fileSizeBytes: 1024,
    });

    const payload = lastPayloadByKey.get('no-skipped-cols') as { html: string };
    expect(payload.html).not.toContain('no longer exist');
  });
});

describe('sendFailureEmail - plain-language body, never a stack trace or a bare error code', () => {
  it('renders the mapped plain-language advice for a known error code', async () => {
    await sendFailureEmail({
      recipients: ['user@example.com'],
      idempotencyKey: 'failure-mapped',
      exportName: 'My Export',
      errorCode: 'SEARCH_CAP_EXCEEDED',
      errorMessage: 'Search returned total=10042 which exceeds cap 10000 at fetch.ts:94:13',
    });

    const payload = lastPayloadByKey.get('failure-mapped') as { html: string };
    expect(payload.html).toContain('Add a narrower filter');
    // The raw technical message (and its embedded code location) must never
    // reach the customer, regardless of what upstream happened to put in it.
    expect(payload.html).not.toContain('fetch.ts');
    expect(payload.html).not.toContain('10042');
  });

  it('falls back to a generic plain-language message for an unmapped/internal error code', async () => {
    await sendFailureEmail({
      recipients: ['user@example.com'],
      idempotencyKey: 'failure-unmapped',
      exportName: 'My Export',
      errorCode: 'INTERNAL',
      errorMessage: "TypeError: Cannot read properties of undefined (reading 'foo')\n    at Object.<anonymous> (/app/lib/x.ts:12:5)",
    });

    const payload = lastPayloadByKey.get('failure-unmapped') as { html: string };
    expect(payload.html).toContain('Something went wrong');
    expect(payload.html).not.toContain('TypeError');
    expect(payload.html).not.toContain('at Object');
    expect(payload.html).not.toContain('INTERNAL');
  });

  it('includes a reconnect link only when one is provided (TOKEN_REVOKED)', async () => {
    await sendFailureEmail({
      recipients: ['user@example.com'],
      idempotencyKey: 'failure-reconnect',
      exportName: 'My Export',
      errorCode: 'TOKEN_REVOKED',
      errorMessage: 'grant revoked',
      reconnectUrl: 'https://app.example.com/dashboard',
    });

    const payload = lastPayloadByKey.get('failure-reconnect') as { html: string };
    expect(payload.html).toContain('Reconnect HubSpot');
    expect(payload.html).toContain('https://app.example.com/dashboard');
  });
});

describe('sendReconnectEmail', () => {
  it('sends a reconnect link to the given recipients', async () => {
    await sendReconnectEmail({
      recipients: ['owner@example.com'],
      idempotencyKey: 'reconnect-1',
      reconnectUrl: 'https://app.example.com/dashboard',
    });

    const payload = lastPayloadByKey.get('reconnect-1') as { html: string; to: string[] };
    expect(payload.to).toEqual(['owner@example.com']);
    expect(payload.html).toContain('https://app.example.com/dashboard');
  });

  it('sends nothing when there are no recipients', async () => {
    await sendReconnectEmail({ recipients: [], idempotencyKey: 'reconnect-empty', reconnectUrl: 'https://app.example.com/dashboard' });
    expect(lastPayloadByKey.has('reconnect-empty')).toBe(false);
  });
});

// Defect #2: shared by the attachment (sendSuccessEmail, above) and
// app/api/runs/[id]/download/route.ts's Content-Disposition, so a file
// downloaded from the email and one re-downloaded later from the dashboard
// have the exact same name.
describe('exportFilename - {export-name}_{YYYY-MM-DD}.xlsx, date given explicitly', () => {
  it('slugifies the name and formats the given date, not "today"', () => {
    expect(exportFilename('Départ Clients Été', new Date('2026-08-20T23:59:00Z'))).toBe(
      'depart-clients-ete_2026-08-20.xlsx',
    );
  });
});

describe('buildRunDownloadUrl - defect #2: our own route, never a raw R2 URL', () => {
  afterEach(() => {
    delete process.env.APP_URL;
  });

  it('builds /api/runs/:id/download under APP_URL', () => {
    process.env.APP_URL = 'https://app.example.com';
    expect(buildRunDownloadUrl('run-123')).toBe('https://app.example.com/api/runs/run-123/download');
  });

  it('falls back to localhost:3000 when APP_URL is unset', () => {
    delete process.env.APP_URL;
    expect(buildRunDownloadUrl('run-123')).toBe('http://localhost:3000/api/runs/run-123/download');
  });
});
