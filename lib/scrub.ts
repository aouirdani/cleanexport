/**
 * The one scrubbing implementation shared by lib/logger.ts and every
 * Sentry config (instrumentation-client.ts, sentry.server.config.ts,
 * sentry.edge.config.ts) - specs/07-TASKS.md T22: "a Sentry breadcrumb is a
 * log line: the same scrubbing applies." One function, every caller, so a
 * rule added here protects logs and Sentry events alike instead of two
 * copies quietly drifting apart.
 *
 * Two independent scrub rules, applied together on every walk:
 *
 *   1. KEY-based: any object key matching SENSITIVE_KEY_PATTERN
 *      (`/token|secret|_enc$|password|key|authorization|cookie/i`) has its
 *      value replaced outright, regardless of what that value is. This is
 *      what catches `accessTokenEnc`, `refreshTokenEnc` (both end in
 *      `_enc`), `Authorization` headers, `Cookie`/`cookies`, and anything
 *      literally named token/secret/password/key.
 *
 *   2. VALUE-based: the live values of ENCRYPTION_KEY, SESSION_SECRET and
 *      R2_OBJECT_KEY_SECRET (read fresh from process.env on every call, not
 *      cached - tests change them) are redacted wherever they appear inside
 *      any string, even under an innocuous-looking key. Rule 1 alone
 *      wouldn't catch a secret that leaked into, say, an error message
 *      string under a key like `details`.
 *
 * This never imports lib/crypto.ts (forbidden to modify this task, and
 * there's no need to touch it - decrypting isn't this module's job).
 */

export const SENSITIVE_KEY_PATTERN = /token|secret|_enc$|password|key|authorization|cookie/i;

const REDACTED = '[REDACTED]';

const SECRET_ENV_VARS = ['ENCRYPTION_KEY', 'SESSION_SECRET', 'R2_OBJECT_KEY_SECRET'] as const;

function liveSecretValues(): string[] {
  return SECRET_ENV_VARS.map((name) => process.env[name]).filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

function scrubString(value: string): string {
  let result = value;
  for (const secret of liveSecretValues()) {
    if (result.includes(secret)) result = result.split(secret).join(REDACTED);
  }
  return result;
}

/**
 * Deep-walks any JSON-like value (plain objects, arrays, Sentry events,
 * breadcrumbs, log-context objects...) applying both rules above.
 * `visited` guards against circular references (Sentry events and Error
 * objects can carry them) - unbounded recursion on a cycle would hang the
 * process, exactly the kind of thing observability code must never do.
 */
export function scrubValue<T>(value: T, visited: WeakSet<object> = new WeakSet()): T {
  if (typeof value === 'string') return scrubString(value) as unknown as T;
  if (value === null || typeof value !== 'object') return value;

  if (value instanceof Date) return value;

  const obj = value as unknown as object;
  if (visited.has(obj)) return '[CIRCULAR]' as unknown as T;
  visited.add(obj);

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, visited)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : scrubValue(val, visited);
  }
  return out as unknown as T;
}
