import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, isEncrypted, safeEqual } from '@/lib/crypto';

const KEY_A = randomBytes(32).toString('base64');
const KEY_B = randomBytes(32).toString('base64');

beforeEach(() => { process.env.ENCRYPTION_KEY = KEY_A; });
afterEach(() => { process.env.ENCRYPTION_KEY = KEY_A; });

describe('encrypt / decrypt', () => {
  it('round-trips a plain token', () => {
    const token = 'EXAMPLE-TOKEN-NOT-A-REAL-CREDENTIAL';
    expect(decrypt(encrypt(token))).toBe(token);
  });

  it('round-trips unicode and newlines', () => {
    const s = 'Première ligne\nDeuxième ligne\t— ✅ 日本語';
    expect(decrypt(encrypt(s))).toBe(s);
  });

  it('round-trips an empty string', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });

  it('round-trips a long value', () => {
    const s = 'x'.repeat(100_000);
    expect(decrypt(encrypt(s))).toBe(s);
  });

  it('produces a different ciphertext each call (fresh IV)', () => {
    const a = encrypt('same input');
    const b = encrypt('same input');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(decrypt(b));
  });

  it('emits the documented 4-segment v1 format', () => {
    const parts = encrypt('x').split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    expect(Buffer.from(parts[1], 'base64')).toHaveLength(12);
    expect(Buffer.from(parts[2], 'base64')).toHaveLength(16);
  });

  it('never leaks the plaintext into the payload', () => {
    expect(encrypt('SUPERSECRET')).not.toContain('SUPERSECRET');
  });
});

describe('tamper resistance', () => {
  it('throws when the ciphertext is modified', () => {
    const parts = encrypt('token').split(':');
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] ^= 0xff;
    parts[3] = ct.toString('base64');
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('throws when the auth tag is modified', () => {
    const parts = encrypt('token').split(':');
    const tag = Buffer.from(parts[2], 'base64');
    tag[0] ^= 0xff;
    parts[2] = tag.toString('base64');
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('throws when the IV is modified', () => {
    const parts = encrypt('token').split(':');
    const iv = Buffer.from(parts[1], 'base64');
    iv[0] ^= 0xff;
    parts[1] = iv.toString('base64');
    expect(() => decrypt(parts.join(':'))).toThrow();
  });

  it('throws on a wrong key', () => {
    const payload = encrypt('token');
    process.env.ENCRYPTION_KEY = KEY_B;
    expect(() => decrypt(payload)).toThrow(/tampered|wrong key/i);
  });

  it('throws on an unknown version prefix', () => {
    const payload = encrypt('token').replace(/^v1:/, 'v2:');
    expect(() => decrypt(payload)).toThrow(/version/i);
  });

  it.each(['', 'garbage', 'v1:a:b', 'v1:a:b:c:d'])('throws on malformed input %j', (bad) => {
    expect(() => decrypt(bad)).toThrow();
  });

  it('throws on a wrong-sized IV', () => {
    const parts = encrypt('token').split(':');
    parts[1] = Buffer.alloc(8).toString('base64');
    expect(() => decrypt(parts.join(':'))).toThrow(/IV length/i);
  });
});

describe('key validation', () => {
  it('throws when ENCRYPTION_KEY is absent', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY is not set/);
  });

  it('throws when the key is the wrong length', () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    expect(() => encrypt('x')).toThrow(/32 bytes/);
  });

  it('never includes key material in the error message', () => {
    const secret = randomBytes(16).toString('base64');
    process.env.ENCRYPTION_KEY = secret;
    try { encrypt('x'); } catch (e) { expect((e as Error).message).not.toContain(secret); }
  });
});

describe('helpers', () => {
  it('isEncrypted recognises our payloads and rejects others', () => {
    expect(isEncrypted(encrypt('x'))).toBe(true);
    expect(isEncrypted('EXAMPLE-TOKEN-NOT-A-REAL-CREDENTIALplain-token')).toBe(false);
    expect(isEncrypted(null)).toBe(false);
  });

  it('safeEqual compares correctly', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
