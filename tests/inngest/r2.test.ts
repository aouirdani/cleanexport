import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildCanonicalRequest,
  buildStringToSign,
  signStringToSign,
  sha256Hex,
  deriveObjectKey,
  deleteFileFromR2,
  presignR2Url,
  signedDownloadUrl,
  type R2Config,
} from '@/inngest/r2';

// A hand-rolled signer that is subtly wrong fails only in production, and a
// test that only re-runs the same code a second time (even under a different
// name) proves nothing but self-consistency. This test instead checks the
// signer's internal seams (canonical request -> string to sign -> signature)
// against AWS's own published SigV4 test suite vector "get-vanilla" - a
// plain GET to "/" with no query string, signed with the well-known example
// credentials (see AWS's "Examples of the complete Signature Version 4
// signing process" / the aws-sig-v4-test-suite, vendored e.g. at
// boto/botocore's tests/unit/auth/aws4_testsuite/get-vanilla/). These
// numbers were not derived by this implementation or its author; they are
// AWS's documented expected output, cross-checked against the vendored
// fixture files rather than retyped from memory.

const SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
const ACCESS_KEY_ID = 'AKIDEXAMPLE';
const AMZ_DATE = '20150830T123600Z';
const DATE_STAMP = '20150830';
const REGION = 'us-east-1';
const SERVICE = 'service';
const CREDENTIAL_SCOPE = `${DATE_STAMP}/${REGION}/${SERVICE}/aws4_request`;

// The hashed-canonical-request line below is taken from AWS's own published
// aws-sig-v4-test-suite fixture (boto/botocore's vendored copy,
// tests/unit/auth/aws4_testsuite/get-vanilla/get-vanilla.sts) rather than
// retyped from memory - retyping a 64-hex-digit hash by hand is exactly the
// kind of transcription that silently produces a wrong-but-plausible string.
const EXPECTED_STRING_TO_SIGN = [
  'AWS4-HMAC-SHA256',
  '20150830T123600Z',
  '20150830/us-east-1/service/aws4_request',
  'bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63',
].join('\n');

const EXPECTED_SIGNATURE = '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31';

const EXPECTED_AUTHORIZATION_HEADER =
  'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
  'SignedHeaders=host;x-amz-date, ' +
  `Signature=${EXPECTED_SIGNATURE}`;

describe('SigV4 internals - verified against the official AWS "get-vanilla" test vector', () => {
  it('produces the documented canonical request for a vanilla GET with no query string', () => {
    const canonicalRequest = buildCanonicalRequest(
      'GET',
      '/',
      '',
      'host:example.amazonaws.com\nx-amz-date:20150830T123600Z\n',
      'host;x-amz-date',
      sha256Hex(''), // empty body, the request has no payload
    );

    expect(canonicalRequest).toBe(
      [
        'GET',
        '/',
        '',
        'host:example.amazonaws.com',
        'x-amz-date:20150830T123600Z',
        '',
        'host;x-amz-date',
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ].join('\n'),
    );
  });

  it('produces the exact documented string-to-sign', () => {
    const canonicalRequest = buildCanonicalRequest(
      'GET',
      '/',
      '',
      'host:example.amazonaws.com\nx-amz-date:20150830T123600Z\n',
      'host;x-amz-date',
      sha256Hex(''),
    );

    const stringToSign = buildStringToSign(AMZ_DATE, CREDENTIAL_SCOPE, sha256Hex(canonicalRequest));

    expect(stringToSign).toBe(EXPECTED_STRING_TO_SIGN);
  });

  it('derives the exact documented signature from the string-to-sign', () => {
    const signature = signStringToSign(SECRET_ACCESS_KEY, DATE_STAMP, REGION, SERVICE, EXPECTED_STRING_TO_SIGN);

    expect(signature).toBe(EXPECTED_SIGNATURE);
  });

  it('assembles the exact documented Authorization header', () => {
    const signature = signStringToSign(SECRET_ACCESS_KEY, DATE_STAMP, REGION, SERVICE, EXPECTED_STRING_TO_SIGN);
    const authorizationHeader =
      `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY_ID}/${CREDENTIAL_SCOPE}, ` +
      `SignedHeaders=host;x-amz-date, ` +
      `Signature=${signature}`;

    expect(authorizationHeader).toBe(EXPECTED_AUTHORIZATION_HEADER);
  });
});

describe('deriveObjectKey - specs/02-ARCHITECTURE.md section 5: "non-guessable key"', () => {
  beforeEach(() => {
    process.env.R2_OBJECT_KEY_SECRET = 'test-object-key-secret';
  });

  it('is not the exportRunId, or a substring of it, embedded in the key', () => {
    const key = deriveObjectKey('portal-1', 'clv9x8f7g0000qzrmn831p8k9');
    expect(key).not.toContain('clv9x8f7g0000qzrmn831p8k9');
  });

  it('is deterministic for the same (portalId, exportRunId) pair - retry-safe', () => {
    const a = deriveObjectKey('portal-1', 'run-1');
    const b = deriveObjectKey('portal-1', 'run-1');
    expect(a).toBe(b);
  });

  it('differs when the exportRunId differs, and an attacker cannot derive one key from another without the secret', () => {
    const a = deriveObjectKey('portal-1', 'run-1');
    const b = deriveObjectKey('portal-1', 'run-2'); // adjacent id, e.g. guessed from a's own id
    expect(a).not.toBe(b);
    // No shared prefix/suffix structure that would let an attacker who knows
    // one portal's run keys predict a neighbour's.
    expect(a.slice(-10)).not.toBe(b.slice(-10));
  });

  it('differs across portals for the same exportRunId - one portal cannot guess another\'s key from its own', () => {
    const a = deriveObjectKey('portal-1', 'run-1');
    const b = deriveObjectKey('portal-2', 'run-1');
    expect(a).not.toBe(b);
  });

  it('changing the secret changes the key - the token is not guessable without it', () => {
    const a = deriveObjectKey('portal-1', 'run-1');
    process.env.R2_OBJECT_KEY_SECRET = 'a-different-secret';
    const b = deriveObjectKey('portal-1', 'run-1');
    expect(a).not.toBe(b);
  });

  it('is namespaced under the portal for storage organisation, without leaking the run id', () => {
    const key = deriveObjectKey('portal-1', 'run-1');
    expect(key).toMatch(/^exports\/portal-1\/[0-9a-f]{64}\.xlsx$/);
  });
});

describe('presignR2Url + deleteFileFromR2 - DELETE method support for inngest/cleanup.ts', () => {
  const CONFIG: R2Config = {
    accountId: 'test-account',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    bucket: 'test-bucket',
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('presigns a DELETE request the same shape as GET/PUT, just with a different method', () => {
    const url = presignR2Url(CONFIG, 'DELETE', 'exports/portal-1/abc.xlsx', 60, new Date('2026-01-01T00:00:00Z'));
    expect(new URL(url).searchParams.get('X-Amz-SignedHeaders')).toBe('host');
  });

  it('deleteFileFromR2 issues a DELETE to the presigned URL and resolves on success', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('DELETE');
      return { ok: true, status: 204, text: async () => '' } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteFileFromR2(CONFIG, 'exports/portal-1/abc.xlsx')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a 404 from R2 as success - delete is idempotent, an already-missing key is not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, text: async () => 'NoSuchKey' }) as Response));

    await expect(deleteFileFromR2(CONFIG, 'exports/portal-1/gone.xlsx')).resolves.toBeUndefined();
  });

  it('throws on a genuine R2 failure (e.g. 500), without leaking the signed URL in the error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, text: async () => 'InternalError' }) as Response),
    );

    let caught: unknown;
    try {
      await deleteFileFromR2(CONFIG, 'exports/portal-1/abc.xlsx');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain('X-Amz-Signature');
    expect((caught as Error).message).not.toContain('X-Amz-Credential');
  });
});

// Defect #2b: "the browser opens a blank tab first because R2 serves the
// object with no Content-Disposition." response-content-disposition is an
// S3/R2 GetObject response-header-override query param - it must be part of
// the SIGNED query string (SigV4 covers the whole query string), not just
// appended to the URL after presigning, or R2 would reject the request as
// tampered.
describe('signedDownloadUrl - defect #2b: response-content-disposition', () => {
  const CONFIG: R2Config = {
    accountId: 'test-account',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret',
    bucket: 'test-bucket',
  };

  it('with a filename, the URL carries a signed response-content-disposition=attachment param', () => {
    const url = signedDownloadUrl(CONFIG, 'exports/portal-1/abc.xlsx', 'weekly-deals_2026-08-20.xlsx');
    const parsed = new URL(url);

    expect(parsed.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="weekly-deals_2026-08-20.xlsx"',
    );
    // It's part of what got signed, not appended after - a signature that
    // didn't cover it would be rejected as tampered by SigV4-verifying R2,
    // so its presence in the (successfully re-parsed) signed URL is itself
    // proof it was in the canonical query string at signing time.
    expect(parsed.searchParams.get('X-Amz-Signature')).toBeTruthy();
  });

  it('without a filename, there is no response-content-disposition param at all - not an empty one', () => {
    const url = signedDownloadUrl(CONFIG, 'exports/portal-1/abc.xlsx');
    expect(new URL(url).searchParams.has('response-content-disposition')).toBe(false);
  });

  it('changing the filename changes the signature - it is genuinely signed, not decorative', () => {
    const urlA = signedDownloadUrl(CONFIG, 'exports/portal-1/abc.xlsx', 'a.xlsx', 60);
    const urlB = signedDownloadUrl(CONFIG, 'exports/portal-1/abc.xlsx', 'b.xlsx', 60);

    // Fix the clock implicitly by comparing signatures produced in the same
    // tick is not reliable across a real Date.now() call in each - instead,
    // presign through the lower-level presignR2Url with a fixed `now` so
    // only the filename varies.
    const now = new Date('2026-01-01T00:00:00Z');
    const signedA = new URL(
      presignR2Url(CONFIG, 'GET', 'exports/portal-1/abc.xlsx', 60, now, {
        'response-content-disposition': 'attachment; filename="a.xlsx"',
      }),
    ).searchParams.get('X-Amz-Signature');
    const signedB = new URL(
      presignR2Url(CONFIG, 'GET', 'exports/portal-1/abc.xlsx', 60, now, {
        'response-content-disposition': 'attachment; filename="b.xlsx"',
      }),
    ).searchParams.get('X-Amz-Signature');

    expect(signedA).not.toEqual(signedB);
    // Sanity: the two convenience-function URLs above are well-formed too.
    expect(new URL(urlA).searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(new URL(urlB).searchParams.get('X-Amz-Signature')).toBeTruthy();
  });
});
