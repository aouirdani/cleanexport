import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildAuthorizeUrl, exchangeCodeForTokens, refreshAccessToken, introspect,
  expiresAtFrom, GrantRevokedError, getScopes,
} from '@/lib/hubspot/oauth';
import { AppError } from '@/lib/errors';

const ENV = {
  HUBSPOT_CLIENT_ID: 'client-123',
  HUBSPOT_CLIENT_SECRET: 'secret-456',
  HUBSPOT_REDIRECT_URI: 'http://localhost:3000/api/auth/hubspot/callback',
  HUBSPOT_SCOPES: 'oauth crm.objects.contacts.read crm.objects.deals.read',
};

const okToken = { access_token: 'at', refresh_token: 'rt', expires_in: 1800, token_type: 'bearer' };

const mockFetch = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  });

beforeEach(() => { Object.assign(process.env, ENV); });
afterEach(() => { vi.restoreAllMocks(); });

describe('buildAuthorizeUrl', () => {
  it('includes client id, redirect, scopes and state', () => {
    const u = new URL(buildAuthorizeUrl('st-1'));
    expect(u.origin + u.pathname).toBe('https://app.hubspot.com/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe('client-123');
    expect(u.searchParams.get('redirect_uri')).toBe(ENV.HUBSPOT_REDIRECT_URI);
    expect(u.searchParams.get('state')).toBe('st-1');
    expect(u.searchParams.get('scope')).toContain('crm.objects.contacts.read');
  });

  it('never leaks the client secret into the URL', () => {
    expect(buildAuthorizeUrl('st')).not.toContain('secret-456');
  });

  it('requests no write scope', () => {
    expect(getScopes().some((s) => s.endsWith('.write'))).toBe(false);
  });

  it('throws when configuration is missing', () => {
    delete process.env.HUBSPOT_CLIENT_ID;
    expect(() => buildAuthorizeUrl('st')).toThrow(/HUBSPOT_CLIENT_ID/);
  });
});

describe('exchangeCodeForTokens', () => {
  it('returns the token payload on success', async () => {
    vi.stubGlobal('fetch', mockFetch(200, okToken));
    await expect(exchangeCodeForTokens('code')).resolves.toEqual(okToken);
  });

  it('posts form-encoded with grant_type=authorization_code', async () => {
    const f = mockFetch(200, okToken);
    vi.stubGlobal('fetch', f);
    await exchangeCodeForTokens('the-code');
    const [, init] = f.mock.calls[0];
    expect(init.headers['content-type']).toBe('application/x-www-form-urlencoded');
    const body = init.body.toString();
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=the-code');
  });

  it.each([
    ['BAD_AUTH_CODE', { status: 'BAD_AUTH_CODE', message: 'bad code' }],
    ['invalid_grant', { error: 'invalid_grant', message: 'expired' }],
    ['EXPIRED_AUTHORIZATION_CODE', { status: 'EXPIRED_AUTHORIZATION_CODE', message: 'gone' }],
  ])('throws GrantRevokedError on %s (must not be retried)', async (_l, body) => {
    vi.stubGlobal('fetch', mockFetch(400, body));
    await expect(exchangeCodeForTokens('c')).rejects.toBeInstanceOf(GrantRevokedError);
  });

  it('throws a generic AppError on 500, not GrantRevokedError', async () => {
    vi.stubGlobal('fetch', mockFetch(500, { message: 'boom' }));
    const err = await exchangeCodeForTokens('c').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).not.toBeInstanceOf(GrantRevokedError);
  });

  it('rejects an incomplete token response', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { access_token: 'at' }));
    await expect(exchangeCodeForTokens('c')).rejects.toThrow(/incomplete/i);
  });

  it('tolerates a non-JSON error body', async () => {
    vi.stubGlobal('fetch', mockFetch(502, '<html>gateway</html>'));
    await expect(exchangeCodeForTokens('c')).rejects.toThrow(/502/);
  });
});

describe('refreshAccessToken', () => {
  it('posts grant_type=refresh_token', async () => {
    const f = mockFetch(200, okToken);
    vi.stubGlobal('fetch', f);
    await refreshAccessToken('the-refresh');
    const body = f.mock.calls[0][1].body.toString();
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('refresh_token=the-refresh');
  });

  it('surfaces a revoked grant as GrantRevokedError', async () => {
    vi.stubGlobal('fetch', mockFetch(400, { status: 'BAD_REFRESH_TOKEN', message: 'revoked' }));
    await expect(refreshAccessToken('rt')).rejects.toBeInstanceOf(GrantRevokedError);
  });
});

describe('introspect', () => {
  const info = { hub_id: 149063119, hub_domain: 'x.com', app_id: 1, user: 'a@b.c', user_id: 96879917, scopes: ['oauth'], expires_in: 1800, token_type: 'access' };

  it('returns portal and user identity', async () => {
    vi.stubGlobal('fetch', mockFetch(200, info));
    await expect(introspect('at')).resolves.toEqual(info);
  });

  it('url-encodes the token in the path', async () => {
    const f = mockFetch(200, info);
    vi.stubGlobal('fetch', f);
    await introspect('a/b+c');
    expect(f.mock.calls[0][0]).toContain(encodeURIComponent('a/b+c'));
  });

  it('rejects an incomplete introspection payload', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { hub_domain: 'x' }));
    await expect(introspect('at')).rejects.toThrow(/incomplete/i);
  });
});

describe('expiresAtFrom', () => {
  it('derives expiry from expires_in, never a hardcoded lifetime', () => {
    const now = 1_700_000_000_000;
    expect(expiresAtFrom({ ...okToken, expires_in: 60 }, now).getTime()).toBe(now + 60_000);
    expect(expiresAtFrom({ ...okToken, expires_in: 21600 }, now).getTime()).toBe(now + 21_600_000);
  });
});
