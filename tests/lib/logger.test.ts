import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// lib/logger.ts - specs/07-TASKS.md T22: "one logger module, JSON output,
// level from the environment... every log line carries portalId and, where
// relevant, exportRunId."

describe('logger', () => {
  const originalEnv = { ...process.env };
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('emits a single JSON line containing level, message, time, and the given context', async () => {
    process.env.LOG_LEVEL = 'debug';
    const { logger } = await import('@/lib/logger');

    logger.info('export run started', { portalId: 'portal-1', exportRunId: 'run-1' });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ level: 'info', message: 'export run started', portalId: 'portal-1', exportRunId: 'run-1' });
    expect(typeof parsed.time).toBe('string');
    expect(new Date(parsed.time).toString()).not.toBe('Invalid Date');
  });

  it('routes each level to its matching console method', async () => {
    process.env.LOG_LEVEL = 'debug';
    const { logger } = await import('@/lib/logger');

    logger.debug('d', {});
    logger.info('i', {});
    logger.warn('w', {});
    logger.error('e', {});

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('defaults to "info" level, suppressing debug lines', async () => {
    delete process.env.LOG_LEVEL;
    const { logger } = await import('@/lib/logger');

    logger.debug('should be suppressed', {});
    logger.info('should appear', {});

    expect(debugSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('LOG_LEVEL=warn suppresses info and debug, keeps warn and error', async () => {
    process.env.LOG_LEVEL = 'warn';
    const { logger } = await import('@/lib/logger');

    logger.debug('x', {});
    logger.info('x', {});
    logger.warn('x', {});
    logger.error('x', {});

    expect(debugSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('an invalid LOG_LEVEL falls back to "info" rather than logging nothing or crashing', async () => {
    process.env.LOG_LEVEL = 'not-a-real-level';
    const { logger } = await import('@/lib/logger');

    logger.debug('suppressed', {});
    logger.info('shown', {});

    expect(debugSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('is the scrubbing boundary: a sensitive key in the context never reaches the emitted line', async () => {
    process.env.LOG_LEVEL = 'debug';
    const { logger } = await import('@/lib/logger');

    logger.error('token refresh failed', { portalId: 'portal-1', accessTokenEnc: 'v1:iv:tag:ciphertext' });

    const line = errorSpy.mock.calls[0][0] as string;
    expect(line).not.toContain('v1:iv:tag:ciphertext');
    const parsed = JSON.parse(line);
    expect(parsed.accessTokenEnc).toBe('[REDACTED]');
    expect(parsed.portalId).toBe('portal-1'); // ordinary context fields are untouched
  });

  it('scrubs a live secret env var value appearing anywhere in the context', async () => {
    process.env.LOG_LEVEL = 'debug';
    process.env.ENCRYPTION_KEY = 'the-actual-encryption-key-value';
    const { logger } = await import('@/lib/logger');

    logger.error('decrypt failed', { detail: 'used key the-actual-encryption-key-value and failed' });

    const line = errorSpy.mock.calls[0][0] as string;
    expect(line).not.toContain('the-actual-encryption-key-value');
  });
});
