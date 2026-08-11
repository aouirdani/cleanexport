/**
 * Session and OAuth-state cookies.
 *
 * The session cookie is an AES-256-GCM payload keyed by SESSION_SECRET — authenticated by
 * construction, so a forged or edited cookie fails to decrypt rather than being trusted.
 * It carries identity only. It never carries a HubSpot token.
 */
import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, safeEqual } from '@/lib/crypto';

const SESSION_COOKIE = 'ce_session';
const STATE_COOKIE = 'ce_oauth_state';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const STATE_MAX_AGE = 60 * 10; // 10 minutes — an OAuth round trip, not a day

export interface SessionData {
  /** Internal Portal.id (cuid), not the HubSpot portal id. */
  portalId: string;
  /** HubSpot portal id, as a string: it exceeds the JS safe integer range in some regions. */
  hubspotPortalId: string;
  userId: string;
  issuedAt: number;
}

const secret = () => process.env.SESSION_SECRET;
const isProd = () => process.env.NODE_ENV === 'production';

const baseCookie = {
  httpOnly: true,
  secure: isProd(),
  path: '/',
  // 'lax' is required, not a preference: HubSpot's callback is a top-level GET navigation
  // from another origin. 'strict' would withhold the state cookie and every login would fail.
  sameSite: 'lax' as const,
};

export function encodeSession(data: SessionData): string {
  return encrypt(JSON.stringify(data), secret(), 'SESSION_SECRET');
}

export function decodeSession(raw: string): SessionData | null {
  try {
    const parsed = JSON.parse(decrypt(raw, secret(), 'SESSION_SECRET')) as Partial<SessionData>;
    if (!parsed.portalId || !parsed.userId || !parsed.hubspotPortalId) return null;
    if (typeof parsed.issuedAt !== 'number') return null;
    if (Date.now() - parsed.issuedAt > SESSION_MAX_AGE * 1000) return null; // expiry is enforced server-side too
    return parsed as SessionData;
  } catch {
    return null; // tampered, wrong key, or garbage — all mean "not logged in"
  }
}

export async function createSession(data: Omit<SessionData, 'issuedAt'>): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, encodeSession({ ...data, issuedAt: Date.now() }), {
    ...baseCookie,
    maxAge: SESSION_MAX_AGE,
  });
}

export async function readSession(): Promise<SessionData | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  return raw ? decodeSession(raw) : null;
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/* ---------- OAuth state (CSRF) ---------- */

export function newState(): string {
  return randomBytes(32).toString('base64url');
}

export async function setStateCookie(state: string): Promise<void> {
  const store = await cookies();
  store.set(STATE_COOKIE, state, { ...baseCookie, maxAge: STATE_MAX_AGE });
}

/**
 * Compares the returned state with the stored one and CONSUMES it.
 * Single use: an attacker who observes a state value cannot replay it.
 */
export async function consumeStateCookie(returned: string | null): Promise<boolean> {
  const store = await cookies();
  const stored = store.get(STATE_COOKIE)?.value;
  store.delete(STATE_COOKIE);
  if (!stored || !returned) return false;
  return safeEqual(stored, returned);
}

export const COOKIE_NAMES = { SESSION_COOKIE, STATE_COOKIE } as const;
