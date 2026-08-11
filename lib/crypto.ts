/**
 * AES-256-GCM encryption for HubSpot OAuth tokens at rest.
 *
 * Payload format:  v1:<iv>:<authTag>:<ciphertext>
 * Every component is base64. Base64 never contains ':', so splitting is unambiguous.
 *
 * GCM is authenticated: any tampering with the ciphertext, the IV or the tag makes
 * decrypt() throw rather than return corrupted plaintext.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const TAG_BYTES = 16;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    // Never include the key or any part of it in an error message.
    throw new Error(`ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

export function encrypt(plain: string): string {
  if (typeof plain !== 'string') throw new TypeError('encrypt() expects a string');

  const iv = randomBytes(IV_BYTES); // fresh per call — never reuse an IV with the same key
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decrypt(payload: string): string {
  if (typeof payload !== 'string') throw new TypeError('decrypt() expects a string');

  const parts = payload.split(':');
  if (parts.length !== 4) throw new Error('Malformed ciphertext: expected 4 segments');

  const [version, ivB64, tagB64, ctB64] = parts;
  if (version !== VERSION) throw new Error(`Unsupported ciphertext version: ${version}`);

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');

  // Reject wrong-sized components before handing them to OpenSSL.
  if (iv.length !== IV_BYTES) throw new Error('Malformed ciphertext: bad IV length');
  if (authTag.length !== TAG_BYTES) throw new Error('Malformed ciphertext: bad auth tag length');

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Deliberately opaque: never leak whether the key, the tag or the payload was wrong.
    throw new Error('Decryption failed: ciphertext was tampered with or the key is wrong');
  }
}

/** True when `payload` looks like something this module produced. Does not verify it. */
export function isEncrypted(payload: unknown): boolean {
  return typeof payload === 'string' && payload.startsWith(`${VERSION}:`) && payload.split(':').length === 4;
}

/** Constant-time comparison, for webhook signatures and similar. Not used by encrypt/decrypt. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
