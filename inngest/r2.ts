/**
 * Cloudflare R2 (S3-compatible) access, signed with AWS SigV4.
 *
 * There is no S3 SDK in this project's dependencies, and adding one is out of
 * scope for this file (scope is inngest/ + app/api/inngest/route.ts only, not
 * package.json). R2's S3-compatible endpoint accepts standard SigV4-signed
 * requests, so this hand-rolls the presign algorithm - well-documented and
 * mechanical: canonical request -> string to sign -> derived signing key ->
 * HMAC-SHA256 signature. Presigned URLs (query-string signing, not header
 * signing) are used for both upload and download so the request body never
 * has to be hashed up front - the upload step streams the file straight from
 * disk instead of buffering it in memory.
 *
 * Env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET,
 * R2_OBJECT_KEY_SECRET (see deriveObjectKey below).
 */

import { createHash, createHmac } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

const REGION = 'auto';
const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';
/** S3 SigV4 presigned URLs cap X-Amz-Expires at 7 days - matches spec section 9 exactly. */
export const DOWNLOAD_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function loadR2Config(): R2Config {
  return {
    accountId: requireEnv('R2_ACCOUNT_ID'),
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    bucket: requireEnv('R2_BUCKET'),
  };
}

/**
 * specs/02-ARCHITECTURE.md section 5: "Generated files are stored under a
 * non-guessable key". `ExportRun.id` alone is not good enough for this - it
 * is a cuid, sequential-ish and already visible to the browser (it's the
 * route param on app/api/runs/[id]/download/route.ts), so anyone who can see
 * one run's id can guess at neighbouring ones. The object key mixes in an
 * HMAC of the run id under a secret the client never sees, so knowing (or
 * guessing) an id from another portal is not enough to guess its file's
 * storage location.
 *
 * Deliberately keyed by exportRunId rather than randomBytes()-per-call: the
 * "upload" step in inngest/exportRun.ts can be retried before Inngest
 * memoizes its result (a network blip after the PUT succeeded, say), and a
 * fresh random key on every retry would silently orphan the previous upload
 * in R2 forever (nothing else references it, so the 90-day cleanup cron in
 * inngest/cleanup.ts would never find it - see ExportRun.fileKey getting
 * overwritten). HMAC keeps retries of the same run idempotent onto the same
 * object.
 */
export function deriveObjectKey(portalId: string, exportRunId: string): string {
  const secret = requireEnv('R2_OBJECT_KEY_SECRET');
  const token = createHmac('sha256', secret).update(exportRunId).digest('hex');
  return `exports/${portalId}/${token}.xlsx`;
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** Exported (only) for tests/inngest/r2.test.ts - hashing the empty-body payload for the AWS SigV4 test vector. */
export function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function deriveSigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/**
 * Exported (only) for tests/inngest/r2.test.ts - these are the documented
 * SigV4 seams (canonical request -> string to sign -> signature) verified
 * against AWS's own published "get-vanilla" test vector, independent of
 * R2's region/service or presigning specifics.
 */
export function buildCanonicalRequest(
  method: string,
  canonicalUri: string,
  canonicalQueryString: string,
  canonicalHeaders: string,
  signedHeaders: string,
  payloadHash: string,
): string {
  return [method, canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join('\n');
}

export function buildStringToSign(amzDate: string, credentialScope: string, hashedCanonicalRequest: string): string {
  return [ALGORITHM, amzDate, credentialScope, hashedCanonicalRequest].join('\n');
}

export function signStringToSign(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
  stringToSign: string,
): string {
  return hmac(deriveSigningKey(secretAccessKey, dateStamp, region, service), stringToSign).toString('hex');
}

function amzTimestamp(now: Date): { amzDate: string; dateStamp: string } {
  // YYYYMMDDTHHMMSSZ, per the SigV4 spec - strip separators and milliseconds.
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/** Encodes a key for the canonical URI, keeping "/" literal (it's a path separator, not data). */
function encodeKeyForPath(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

/** Exported (only) for tests/inngest/r2.test.ts - a known-inputs SigV4 cross-check needs a fixed clock. */
export function presignR2Url(
  config: R2Config,
  method: 'GET' | 'PUT' | 'DELETE',
  key: string,
  expiresInSeconds: number,
  now: Date = new Date(),
): string {
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const { amzDate, dateStamp } = amzTimestamp(now);
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const canonicalUri = `/${config.bucket}/${encodeKeyForPath(key)}`;

  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': `${config.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresInSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  // Presigned (query-string) requests never sign the body - UNSIGNED-PAYLOAD is
  // the documented value, not a shortcut.
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = buildCanonicalRequest(
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  );

  const stringToSign = buildStringToSign(amzDate, credentialScope, sha256Hex(canonicalRequest));
  const signature = signStringToSign(config.secretAccessKey, dateStamp, REGION, SERVICE, stringToSign);

  return `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

/**
 * Streams a local file to R2 via a presigned PUT URL. Streaming (not
 * buffering the whole file into memory first) matters for the same reason
 * lib/export/writer.ts streams the XLSX itself - a 250,000-row export can be
 * a large file.
 */
export async function uploadFileToR2(config: R2Config, filePath: string, key: string): Promise<{ sizeBytes: number }> {
  const { size } = await stat(filePath);
  const url = presignR2Url(config, 'PUT', key, 60 * 10); // 10 minutes is ample for an upload to start
  const body = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;

  const res = await fetch(url, {
    method: 'PUT',
    body,
    duplex: 'half',
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-length': String(size),
    },
  } as RequestInit & { duplex: 'half' });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`R2 upload failed: ${res.status} ${text.slice(0, 300)}`);
  }

  return { sizeBytes: size };
}

/** A signed, TTL-limited download URL - never a public/permanent one (spec section 9). */
export function signedDownloadUrl(config: R2Config, key: string, expiresInSeconds = DOWNLOAD_URL_TTL_SECONDS): string {
  return presignR2Url(config, 'GET', key, expiresInSeconds);
}

/**
 * Deletes one object from R2 - used by inngest/cleanup.ts's 90-day retention
 * sweep. S3-compatible DELETE is idempotent (deleting an already-missing key
 * still returns success), so this doesn't special-case 404: a retry after a
 * dropped response, or a key that was already cleaned up, is not an error.
 */
export async function deleteFileFromR2(config: R2Config, key: string): Promise<void> {
  const url = presignR2Url(config, 'DELETE', key, 60); // used immediately, not stored - a short TTL is enough
  const res = await fetch(url, { method: 'DELETE' });

  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`R2 delete failed: ${res.status} ${text.slice(0, 300)}`);
  }
}
