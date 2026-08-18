import { describe, it, expect } from 'vitest';
import { sentryBeforeSend, sentryBeforeBreadcrumb } from '@/lib/sentryHooks';
import type { ErrorEvent, Breadcrumb, EventHint } from '@sentry/nextjs';

// lib/sentryHooks.ts - specs/07-TASKS.md T22, THE TEST THAT MATTERS #3:
// "a test that runs a payload with a known secret through Sentry's
// beforeSend and asserts it comes out scrubbed." These are the exact
// functions wired into Sentry.init's beforeSend/beforeBreadcrumb in
// instrumentation-client.ts, sentry.server.config.ts, and
// sentry.edge.config.ts - not a re-implementation of them.

const NO_OP_HINT = {} as EventHint;

describe('sentryBeforeSend', () => {
  it('scrubs a decrypted token appearing in exception context, keeping the event shape intact', () => {
    const event = {
      event_id: 'abc123',
      exception: { values: [{ type: 'Error', value: 'HubSpot request failed' }] },
      extra: {
        portalId: 'portal-1',
        accessTokenEnc: 'v1:iv:tag:decrypted-token-should-never-reach-here',
      },
      request: {
        headers: { authorization: 'Bearer known-secret-access-token-xyz', 'content-type': 'application/json' },
        cookies: { ce_session: 'known-secret-session-cookie-value' },
      },
    } as unknown as ErrorEvent;

    const result = sentryBeforeSend(event, NO_OP_HINT);

    expect(result.event_id).toBe('abc123'); // ordinary fields survive
    expect((result.extra as Record<string, unknown>).portalId).toBe('portal-1');
    expect((result.extra as Record<string, unknown>).accessTokenEnc).toBe('[REDACTED]');
    expect((result.request!.headers as Record<string, unknown>).authorization).toBe('[REDACTED]');
    expect((result.request!.headers as Record<string, unknown>)['content-type']).toBe('application/json');
    expect(result.request!.cookies).toBe('[REDACTED]');

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('decrypted-token-should-never-reach-here');
    expect(serialized).not.toContain('known-secret-access-token-xyz');
    expect(serialized).not.toContain('known-secret-session-cookie-value');
  });

  it('scrubs a live secret env var value appearing anywhere in the event, not just under a sensitive key', () => {
    const original = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'the-real-encryption-key-material';
    try {
      const event = {
        exception: { values: [{ value: 'decrypt failed using key the-real-encryption-key-material' }] },
      } as unknown as ErrorEvent;

      const result = sentryBeforeSend(event, NO_OP_HINT);

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('the-real-encryption-key-material');
      expect(serialized).toContain('[REDACTED]');
    } finally {
      process.env.ENCRYPTION_KEY = original;
    }
  });

  it('scrubs sensitive keys inside breadcrumbs carried on the event ("a breadcrumb is a log line")', () => {
    const event = {
      breadcrumbs: [
        { category: 'fetch', data: { url: 'https://api.hubapi.com/x', refreshTokenEnc: 'v1:leak:leak:leak' } },
      ],
    } as unknown as ErrorEvent;

    const result = sentryBeforeSend(event, NO_OP_HINT);

    expect(result.breadcrumbs![0].data!.refreshTokenEnc).toBe('[REDACTED]');
    expect(result.breadcrumbs![0].data!.url).toBe('https://api.hubapi.com/x');
  });
});

describe('sentryBeforeBreadcrumb - a breadcrumb is a log line: the same scrubbing applies', () => {
  it('scrubs a sensitive key on a standalone breadcrumb, independent of beforeSend', () => {
    const breadcrumb = {
      category: 'http',
      message: 'HubSpot call',
      data: { password: 'hunter2', portalId: 'portal-1' },
    } as unknown as Breadcrumb;

    const result = sentryBeforeBreadcrumb(breadcrumb);

    expect(result.data!.password).toBe('[REDACTED]');
    expect(result.data!.portalId).toBe('portal-1');
  });

  it('scrubs a known secret value embedded in a breadcrumb message', () => {
    const original = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'the-real-session-secret-value';
    try {
      const breadcrumb = { message: 'cookie signed with the-real-session-secret-value' } as unknown as Breadcrumb;

      const result = sentryBeforeBreadcrumb(breadcrumb);

      expect(result.message).not.toContain('the-real-session-secret-value');
    } finally {
      process.env.SESSION_SECRET = original;
    }
  });
});
