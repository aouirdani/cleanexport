/**
 * HubSpot OAuth 2.0 — pure HTTP, no database, no cookies.
 *
 * Reference: specs/04-HUBSPOT-INTEGRATION.md §2.
 * Nothing in this file logs, returns or throws a token. Error messages are built from
 * HubSpot's response body, which HubSpot does not echo tokens into — but we still never
 * interpolate our own token values into them.
 */
import { AppError, ErrorCode } from '@/lib/errors';

const AUTHORIZE_URL = 'https://app.hubspot.com/oauth/authorize';
const TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';
const INTROSPECT_URL = 'https://api.hubapi.com/oauth/v1/access-tokens';

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  /** Seconds. Read it — never hardcode a lifetime. */
  expires_in: number;
  token_type: string;
}

export interface TokenInfo {
  hub_id: number;
  hub_domain: string;
  app_id: number;
  user: string;
  user_id: number;
  scopes: string[];
  expires_in: number;
  token_type: string;
}

/** Thrown when HubSpot reports the grant is gone. The caller must NOT retry. */
export class GrantRevokedError extends AppError {
  constructor(message = 'HubSpot access was revoked by the user') {
    super(ErrorCode.TOKEN_REVOKED, message, 401);
    this.name = 'GrantRevokedError';
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new AppError(ErrorCode.INTERNAL, `${name} is not set`, 500);
  return v;
}

export function getScopes(): string[] {
  return requireEnv('HUBSPOT_SCOPES').split(/\s+/).filter(Boolean);
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv('HUBSPOT_CLIENT_ID'),
    redirect_uri: requireEnv('HUBSPOT_REDIRECT_URI'),
    scope: getScopes().join(' '),
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

async function postToken(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  const text = await res.text();

  if (!res.ok) {
    // HubSpot returns 400 { "status": "BAD_AUTH_CODE" | ..., "message": ... }
    // A revoked or already-used grant must never be retried: a retry loop on
    // invalid_grant gets the whole application rate limited by HubSpot.
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* keep the raw text below */
    }
    const marker = `${parsed.error ?? ''} ${parsed.status ?? ''} ${parsed.message ?? ''}`.toUpperCase();

    if (res.status === 400 && /INVALID_GRANT|EXPIRED_AUTH|BAD_AUTH_CODE|BAD_REFRESH_TOKEN/.test(marker)) {
      throw new GrantRevokedError();
    }
    throw new AppError(
      ErrorCode.OAUTH_EXCHANGE_FAILED,
      `HubSpot token endpoint returned ${res.status}: ${String(parsed.message ?? text).slice(0, 300)}`,
      502,
    );
  }

  const data = JSON.parse(text) as Partial<TokenResponse>;
  if (!data.access_token || !data.refresh_token || typeof data.expires_in !== 'number') {
    throw new AppError(ErrorCode.OAUTH_EXCHANGE_FAILED, 'HubSpot token response was incomplete', 502);
  }
  return data as TokenResponse;
}

export function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: requireEnv('HUBSPOT_CLIENT_ID'),
      client_secret: requireEnv('HUBSPOT_CLIENT_SECRET'),
      redirect_uri: requireEnv('HUBSPOT_REDIRECT_URI'),
      code,
    }),
  );
}

export function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  return postToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: requireEnv('HUBSPOT_CLIENT_ID'),
      client_secret: requireEnv('HUBSPOT_CLIENT_SECRET'),
      refresh_token: refreshToken,
    }),
  );
}

export async function introspect(accessToken: string): Promise<TokenInfo> {
  const res = await fetch(`${INTROSPECT_URL}/${encodeURIComponent(accessToken)}`);
  if (!res.ok) {
    throw new AppError(
      ErrorCode.OAUTH_INTROSPECTION_FAILED,
      `HubSpot introspection returned ${res.status}`,
      502,
    );
  }
  const info = (await res.json()) as Partial<TokenInfo>;
  if (typeof info.hub_id !== 'number' || typeof info.user_id !== 'number') {
    throw new AppError(ErrorCode.OAUTH_INTROSPECTION_FAILED, 'Introspection response was incomplete', 502);
  }
  return info as TokenInfo;
}

/** Absolute expiry from a token response. Always derived from expires_in, never assumed. */
export function expiresAtFrom(token: TokenResponse, now = Date.now()): Date {
  return new Date(now + token.expires_in * 1000);
}
