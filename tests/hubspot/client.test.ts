import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HubSpotClient, type PortalTokens } from '@/lib/hubspot/client';
import { TokenBucket } from '@/lib/hubspot/rateLimiter';
import { encrypt } from '@/lib/crypto';
import { AppError } from '@/lib/errors';
import { GrantRevokedError } from '@/lib/hubspot/oauth';

const KEY = Buffer.alloc(32, 7).toString('base64');
const HOUR = 3600_000;

function portal(expiresInMs = 24 * HOUR): PortalTokens {
  return {
    id: 'portal-1',
    hubspotPortalId: BigInt(149063119),
    accessTokenEnc: encrypt('access-original'),
    refreshTokenEnc: encrypt('refresh-1'),
    tokenExpiresAt: new Date(Date.now() + expiresInMs),
  };
}

const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

function opts(fetchImpl: unknown, extra: Record<string, unknown> = {}) {
  return {
    fetchImpl: fetchImpl as typeof fetch,
    bucket: new TokenBucket({ capacity: 1000, refillWindowMs: 1, now: () => 0, sleep: async () => {} }),
    sleep: async () => {},
    persist: async () => {},
    ...extra,
  };
}

beforeEach(() => {
  process.env.ENCRYPTION_KEY = KEY;
  process.env.HUBSPOT_API_VERSION = '2026-03';
  process.env.HUBSPOT_CLIENT_ID = 'cid';
  process.env.HUBSPOT_CLIENT_SECRET = 'csecret';
  vi.restoreAllMocks();
});

describe('requests', () => {
  it('returns parsed JSON and counts the call', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { results: [1] }));
    const c = new HubSpotClient(portal(), opts(f));
    await expect(c.request('/x')).resolves.toEqual({ results: [1] });
    expect(c.callCount).toBe(1);
  });

  it('sends the bearer token', async () => {
    const f = vi.fn().mockResolvedValue(res(200));
    await new HubSpotClient(portal(), opts(f)).request('/x');
    expect(f.mock.calls[0][1].headers.authorization).toBe('Bearer access-original');
  });

  it('accepts 207 when asked — batch endpoints return it (FINDINGS §11)', async () => {
    const body = { status: 'COMPLETE', results: [], errors: [{ status: 'error' }] };
    const f = vi.fn().mockResolvedValue(res(207, body));
    const c = new HubSpotClient(portal(), opts(f));
    await expect(c.request('/b', { acceptStatus: [207] })).resolves.toEqual(body);
  });

  it('accepts 207 even without acceptStatus — Response.ok covers 200-299', async () => {
    // Per the Fetch spec, res.ok is true for any 2xx, 207 included. The hazard is not
    // res.ok but code written as `if (res.status !== 200)`, which would reject every
    // partially-successful batch read. Asserting this pins the behaviour.
    const f = vi.fn().mockResolvedValue(res(207, { results: [], errors: [] }));
    await expect(new HubSpotClient(portal(), opts(f)).request('/b')).resolves.toEqual({ results: [], errors: [] });
  });

  it('does not retry a deterministic 400', async () => {
    const f = vi.fn().mockResolvedValue(res(400, 'bad request'));
    await expect(new HubSpotClient(portal(), opts(f)).request('/x')).rejects.toThrow(/400/);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('429 and 5xx backoff', () => {
  it('retries a 429 then succeeds', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res(429, {}, { 'retry-after': '2' }))
      .mockResolvedValueOnce(res(200, { ok: true }));
    const c = new HubSpotClient(portal(), opts(f));
    await expect(c.request('/x')).resolves.toEqual({ ok: true });
    expect(c.callCount).toBe(2);
  });

  it('honours Retry-After in seconds', async () => {
    const slept: number[] = [];
    const f = vi.fn()
      .mockResolvedValueOnce(res(429, {}, { 'retry-after': '3' }))
      .mockResolvedValueOnce(res(200));
    await new HubSpotClient(portal(), opts(f, { sleep: async (ms: number) => { slept.push(ms); } })).request('/x');
    expect(slept[0]).toBe(3000);
  });

  it('caps Retry-After at 60s', async () => {
    const slept: number[] = [];
    const f = vi.fn()
      .mockResolvedValueOnce(res(429, {}, { 'retry-after': '9999' }))
      .mockResolvedValueOnce(res(200));
    await new HubSpotClient(portal(), opts(f, { sleep: async (ms: number) => { slept.push(ms); } })).request('/x');
    expect(slept[0]).toBe(60_000);
  });

  it('gives up after 5 attempts', async () => {
    const f = vi.fn().mockResolvedValue(res(503, {}));
    const c = new HubSpotClient(portal(), opts(f));
    await expect(c.request('/x')).rejects.toBeInstanceOf(AppError);
    expect(c.callCount).toBe(5);
  });

  it('retries a network failure', async () => {
    const f = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(res(200, { ok: true }));
    await expect(new HubSpotClient(portal(), opts(f)).request('/x')).resolves.toEqual({ ok: true });
  });
});

describe('token refresh', () => {
  const refreshOk = {
    ok: true, status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ access_token: 'access-new', refresh_token: 'refresh-2', expires_in: 1800, token_type: 'bearer' }),
  };

  it('refreshes proactively when expiry is inside the 2h margin', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(refreshOk)          // token endpoint
      .mockResolvedValueOnce(res(200, { ok: 1 })); // actual call
    const c = new HubSpotClient(portal(30 * 60_000), opts(f));
    await c.request('/x');
    expect(f.mock.calls[0][0]).toContain('/oauth/v1/token');
    expect(f.mock.calls[1][1].headers.authorization).toBe('Bearer access-new');
  });

  it('does not refresh when the token is comfortably valid', async () => {
    const f = vi.fn().mockResolvedValue(res(200));
    await new HubSpotClient(portal(24 * HOUR), opts(f)).request('/x');
    expect(f.mock.calls[0][0]).not.toContain('/oauth/v1/token');
  });

  it('refreshes reactively on 401 and retries exactly once', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res(401, {}))
      .mockResolvedValueOnce(refreshOk)
      .mockResolvedValueOnce(res(200, { ok: 1 }));
    const c = new HubSpotClient(portal(), opts(f));
    await expect(c.request('/x')).resolves.toEqual({ ok: 1 });
  });

  it('does not loop on repeated 401s', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(res(401, {}))
      .mockResolvedValueOnce(refreshOk)
      .mockResolvedValue(res(401, 'still unauthorized'));
    await expect(new HubSpotClient(portal(), opts(f)).request('/x')).rejects.toThrow(/401/);
  });

  it('persists the re-encrypted access token', async () => {
    const saved: unknown[] = [];
    const f = vi.fn().mockResolvedValueOnce(refreshOk).mockResolvedValueOnce(res(200));
    await new HubSpotClient(portal(60_000), opts(f, {
      persist: async (_id: string, d: unknown) => { saved.push(d); },
    })).request('/x');
    const rec = saved[0] as { accessTokenEnc: string };
    expect(rec.accessTokenEnc).toMatch(/^v1:/);
    expect(rec.accessTokenEnc).not.toContain('access-new');
  });

  it('calls onRevoked and stops when the grant is gone', async () => {
    const revoked: string[] = [];
    const f = vi.fn().mockResolvedValue({
      ok: false, status: 400,
      headers: { get: () => null },
      text: async () => JSON.stringify({ status: 'BAD_REFRESH_TOKEN', message: 'revoked' }),
    });
    const c = new HubSpotClient(portal(60_000), opts(f, {
      onRevoked: async (id: string) => { revoked.push(id); },
    }));
    await expect(c.request('/x')).rejects.toBeInstanceOf(GrantRevokedError);
    expect(revoked).toEqual(['portal-1']);
    expect(f).toHaveBeenCalledTimes(1); // never retried
  });

  it('shares a single refresh between concurrent callers', async () => {
    let tokenCalls = 0;
    const f = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/oauth/v1/token')) { tokenCalls++; return Promise.resolve(refreshOk); }
      return Promise.resolve(res(200, { ok: 1 }));
    });
    const c = new HubSpotClient(portal(60_000), opts(f));
    await Promise.all([c.request('/a'), c.request('/b'), c.request('/c')]);
    expect(tokenCalls).toBe(1);
  });
});

describe('paths', () => {
  it('pins the API version from the environment', async () => {
    const f = vi.fn().mockResolvedValue(res(200));
    await new HubSpotClient(portal(), opts(f)).properties('contacts');
    expect(f.mock.calls[0][0]).toBe('https://api.hubapi.com/crm/properties/2026-03/contacts');
  });

  it('keeps associations on v4 — two version schemes coexist', async () => {
    const f = vi.fn().mockResolvedValue(res(200));
    await new HubSpotClient(portal(), opts(f)).batchReadAssociations('deals', 'companies', [{ id: '1' }]);
    expect(f.mock.calls[0][0]).toContain('/crm/v4/associations/deals/companies/batch/read');
  });

  it('accepts 207 on batch association reads', async () => {
    const f = vi.fn().mockResolvedValue(res(207, { results: [], errors: [] }));
    const c = new HubSpotClient(portal(), opts(f));
    await expect(c.batchReadAssociations('deals', 'companies', [{ id: '1' }])).resolves.toBeTruthy();
  });
});

describe('rate limiting', () => {
  it('acquires a token before every call', async () => {
    let acquired = 0;
    const bucket = { acquire: async () => { acquired++; }, available: 100 } as unknown as TokenBucket;
    const f = vi.fn().mockResolvedValue(res(200));
    const c = new HubSpotClient(portal(), opts(f, { bucket }));
    await c.request('/a'); await c.request('/b');
    expect(acquired).toBe(2);
  });

  it('counts retried attempts too', async () => {
    let acquired = 0;
    const bucket = { acquire: async () => { acquired++; }, available: 100 } as unknown as TokenBucket;
    const f = vi.fn().mockResolvedValueOnce(res(429, {})).mockResolvedValueOnce(res(200));
    await new HubSpotClient(portal(), opts(f, { bucket })).request('/x');
    expect(acquired).toBe(2);
  });
});
