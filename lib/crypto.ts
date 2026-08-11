/**
 * AES-256-GCM encryption.
 *
 * Payload format:  v1:<iv>:<authTag>:<ciphertext>   (all base64)
 * Base64 never contains ':', so splitting is unambiguous.
 *
 * GCM is authenticated: tampering with the ciphertext, IV or tag makes decrypt() throw
 * rather than return corrupted plaintext.
 *
 * Two keys are in play in this project and they are deliberately separate:
 *   ENCRYPTION_KEY  — HubSpot refresh/access tokens at rest (default)
 *   SESSION_SECRET  — session cookies (passed explicitly by lib/session.ts)
 * Separating them means a leaked session key cannot decrypt customer tokens.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function resolveKey(explicit?: string, envName = 'ENCRYPTION_KEY'): Buffer {
  const raw = explicit ?? process.env[envName];
  if (!raw) {
    throw new Error(`${envName} is not set. Generate one with: openssl rand -base64 32`);
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    // Never include key material in an error message.
    throw new Error(`${envName} must decode to ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return key;
}

export function encrypt(plain: string, keyB64?: string, envName?: string): string {
  if (typeof plain !== 'string') throw new TypeError('encrypt() expects a string');

  const iv = randomBytes(IV_BYTES); // fresh per call — reusing an IV breaks GCM
  const cipher = createCipheriv(ALGORITHM, resolveKey(keyB64, envName), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);

  return [
    VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

export function decrypt(payload: string, keyB64?: string, envName?: string): string {
  if (typeof payload !== 'string') throw new TypeError('decrypt() expects a string');

  const parts = payload.split(':');
  if (parts.length !== 4) throw new Error('Malformed ciphertext: expected 4 segments');

  const [version, ivB64, tagB64, ctB64] = parts;
  if (version !== VERSION) throw new Error(`Unsupported ciphertext version: ${version}`);

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');

  if (iv.length !== IV_BYTES) throw new Error('Malformed ciphertext: bad IV length');
  if (authTag.length !== TAG_BYTES) throw new Error('Malformed ciphertext: bad auth tag length');

  const decipher = createDecipheriv(ALGORITHM, resolveKey(keyB64, envName), iv);
  decipher.setAuthTag(authTag);

  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Opaque on purpose: never reveal whether the key, the tag or the payload was wrong.
    throw new Error('Decryption failed: ciphertext was tampered with or the key is wrong');
  }
}

export function isEncrypted(payload: unknown): boolean {
  return typeof payload === 'string' && payload.startsWith(`${VERSION}:`) && payload.split(':').length === 4;
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
