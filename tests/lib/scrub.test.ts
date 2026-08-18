import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scrubValue, SENSITIVE_KEY_PATTERN } from '@/lib/scrub';

// lib/scrub.ts - specs/07-TASKS.md T22. The single scrub implementation
// shared by lib/logger.ts and every Sentry config.

describe('SENSITIVE_KEY_PATTERN - the exact rule the task specifies', () => {
  it.each([
    'token',
    'accessToken',
    'refreshToken',
    'secret',
    'clientSecret',
    'accessTokenEnc',
    'refreshTokenEnc',
    'password',
    'apiKey',
    'key',
    'authorization',
    'Authorization',
    'cookie',
    'Cookie',
    'cookies',
  ])('matches key "%s"', (key) => {
    expect(SENSITIVE_KEY_PATTERN.test(key)).toBe(true);
  });

  it.each(['portalId', 'exportRunId', 'name', 'email', 'status', 'url', 'rowCount'])(
    'does not match an ordinary key "%s"',
    (key) => {
      expect(SENSITIVE_KEY_PATTERN.test(key)).toBe(false);
    },
  );

  it('_enc$ matches a literal "_enc" suffix, even with no other trigger word present', () => {
    expect(SENSITIVE_KEY_PATTERN.test('cache_enc')).toBe(true);
  });

  it('_enc$ only anchors at the END of the key - "enc" elsewhere does not trigger it alone', () => {
    expect(SENSITIVE_KEY_PATTERN.test('encoding')).toBe(false);
    expect(SENSITIVE_KEY_PATTERN.test('cache_encoding')).toBe(false);
  });

  it('accessTokenEnc/refreshTokenEnc (this project\'s actual field names) match via "token", regardless of _enc$', () => {
    expect(SENSITIVE_KEY_PATTERN.test('accessTokenEnc')).toBe(true);
    expect(SENSITIVE_KEY_PATTERN.test('refreshTokenEnc')).toBe(true);
  });
});

describe('scrubValue - key-based redaction', () => {
  it('redacts a top-level sensitive key, replacing the value entirely', () => {
    expect(scrubValue({ accessTokenEnc: 'v1:abc:def:ghi' })).toEqual({ accessTokenEnc: '[REDACTED]' });
  });

  it('redacts sensitive keys at any depth', () => {
    const input = { user: { session: { token: 'abc123' } } };
    expect(scrubValue(input)).toEqual({ user: { session: { token: '[REDACTED]' } } });
  });

  it('redacts inside arrays of objects', () => {
    const input = [{ password: 'hunter2' }, { name: 'fine' }];
    expect(scrubValue(input)).toEqual([{ password: '[REDACTED]' }, { name: 'fine' }]);
  });

  it('redacts regardless of the value\'s type (number, object, array under a sensitive key)', () => {
    expect(scrubValue({ apiKey: 12345 })).toEqual({ apiKey: '[REDACTED]' });
    expect(scrubValue({ secret: { nested: 'still gone' } })).toEqual({ secret: '[REDACTED]' });
  });

  it('leaves ordinary keys and values untouched', () => {
    const input = { portalId: 'portal-1', exportRunId: 'run-1', rowCount: 42 };
    expect(scrubValue(input)).toEqual(input);
  });

  it('redacts an authorization header specifically', () => {
    expect(scrubValue({ headers: { authorization: 'Bearer abc.def.ghi' } })).toEqual({
      headers: { authorization: '[REDACTED]' },
    });
  });

  it('redacts cookies specifically (both a "cookie" header and a "cookies" object)', () => {
    expect(scrubValue({ headers: { cookie: 'ce_session=xyz' } })).toEqual({ headers: { cookie: '[REDACTED]' } });
    expect(scrubValue({ request: { cookies: { ce_session: 'xyz' } } })).toEqual({
      request: { cookies: '[REDACTED]' },
    });
  });
});

describe('scrubValue - value-based redaction of live secret env vars', () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'super-secret-encryption-key-value';
    process.env.SESSION_SECRET = 'super-secret-session-value';
    process.env.R2_OBJECT_KEY_SECRET = 'super-secret-r2-value';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('redacts the ENCRYPTION_KEY value wherever it appears in a string, even under an innocuous key', () => {
    const input = { details: `failed using key super-secret-encryption-key-value during retry` };
    const result = scrubValue(input);
    expect(result.details).not.toContain('super-secret-encryption-key-value');
    expect(result.details).toContain('[REDACTED]');
  });

  it('redacts SESSION_SECRET and R2_OBJECT_KEY_SECRET the same way', () => {
    const input = {
      a: 'contains super-secret-session-value inline',
      b: 'contains super-secret-r2-value inline',
    };
    const result = scrubValue(input);
    expect(result.a).not.toContain('super-secret-session-value');
    expect(result.b).not.toContain('super-secret-r2-value');
  });

  it('redacts multiple occurrences of the same secret in one string', () => {
    const input = { msg: 'super-secret-encryption-key-value ... super-secret-encryption-key-value' };
    const result = scrubValue(input);
    expect(result.msg).not.toContain('super-secret-encryption-key-value');
    expect(result.msg.split('[REDACTED]')).toHaveLength(3);
  });

  it('does nothing when the env vars are unset', () => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.SESSION_SECRET;
    delete process.env.R2_OBJECT_KEY_SECRET;

    const input = { msg: 'nothing sensitive here' };
    expect(scrubValue(input)).toEqual(input);
  });
});

describe('scrubValue - structural safety', () => {
  it('handles circular references without hanging, replacing the cycle with a marker', () => {
    const obj: Record<string, unknown> = { name: 'ok' };
    obj.self = obj;

    const result = scrubValue(obj) as Record<string, unknown>;
    expect(result.name).toBe('ok');
    expect(result.self).toBe('[CIRCULAR]');
  });

  it('passes Date instances through unchanged', () => {
    const date = new Date('2026-01-01T00:00:00Z');
    expect(scrubValue({ time: date }).time).toBe(date);
  });

  it('passes primitives through unchanged', () => {
    expect(scrubValue(null)).toBeNull();
    expect(scrubValue(undefined)).toBeUndefined();
    expect(scrubValue(42)).toBe(42);
    expect(scrubValue(true)).toBe(true);
  });

  it('does not mutate the input', () => {
    const input = { token: 'abc', name: 'ok' };
    const copy = { ...input };
    scrubValue(input);
    expect(input).toEqual(copy);
  });
});
