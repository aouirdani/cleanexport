import { describe, it, expect, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encodeSession, decodeSession, newState, type SessionData } from '@/lib/session';

const KEY = randomBytes(32).toString('base64');
const OTHER = randomBytes(32).toString('base64');

const data: Omit<SessionData, 'issuedAt'> = {
  portalId: 'ckl1',
  hubspotPortalId: '149063119',
  userId: 'usr1',
};

beforeEach(() => { process.env.SESSION_SECRET = KEY; });

describe('session payload', () => {
  it('round-trips', () => {
    const s = decodeSession(encodeSession({ ...data, issuedAt: Date.now() }));
    expect(s?.portalId).toBe('ckl1');
    expect(s?.hubspotPortalId).toBe('149063119');
  });

  it('keeps the hubspot portal id as a string', () => {
    const s = decodeSession(encodeSession({ ...data, hubspotPortalId: '9007199254740993', issuedAt: Date.now() }));
    expect(s?.hubspotPortalId).toBe('9007199254740993');
  });

  it('never contains a token field', () => {
    const raw = encodeSession({ ...data, issuedAt: Date.now() });
    expect(raw.toLowerCase()).not.toContain('token');
  });

  it('returns null when tampered with', () => {
    const raw = encodeSession({ ...data, issuedAt: Date.now() }).split(':');
    const ct = Buffer.from(raw[3], 'base64'); ct[0] ^= 0xff; raw[3] = ct.toString('base64');
    expect(decodeSession(raw.join(':'))).toBeNull();
  });

  it('returns null under a different secret', () => {
    const raw = encodeSession({ ...data, issuedAt: Date.now() });
    process.env.SESSION_SECRET = OTHER;
    expect(decodeSession(raw)).toBeNull();
  });

  it.each(['', 'garbage', 'v1:a:b'])('returns null on malformed input %j', (bad) => {
    expect(decodeSession(bad)).toBeNull();
  });

  it('rejects an expired session', () => {
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    expect(decodeSession(encodeSession({ ...data, issuedAt: old }))).toBeNull();
  });

  it('rejects a session missing required fields', () => {
    const raw = encodeSession({ portalId: '', hubspotPortalId: '1', userId: 'u', issuedAt: Date.now() });
    expect(decodeSession(raw)).toBeNull();
  });
});

describe('newState', () => {
  it('is long, url-safe and unique', () => {
    const a = newState(), b = newState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
