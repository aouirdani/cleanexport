import { describe, it, expect, vi, beforeEach } from 'vitest';

// lib/currentPortal.ts - the shared session/portal resolver behind
// GET /api/auth/session and every server component under app/(app).

const { readSessionMock } = vi.hoisted(() => ({ readSessionMock: vi.fn() }));
vi.mock('@/lib/session', () => ({ readSession: readSessionMock }));

const { findPortalMock, findUserMock } = vi.hoisted(() => ({
  findPortalMock: vi.fn(),
  findUserMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    portal: { findUnique: findPortalMock },
    user: { findUnique: findUserMock },
  },
}));

const { getCurrentSession } = await import('@/lib/currentPortal');

const SESSION = { portalId: 'portal-1', hubspotPortalId: '123', userId: 'user-1', issuedAt: Date.now() };

beforeEach(() => {
  readSessionMock.mockReset();
  findPortalMock.mockReset();
  findUserMock.mockReset();
});

describe('getCurrentSession', () => {
  it('returns NOT_AUTHENTICATED when there is no session cookie at all', async () => {
    readSessionMock.mockResolvedValue(null);

    const result = await getCurrentSession();

    expect(result).toEqual({ ok: false, reason: 'NOT_AUTHENTICATED' });
    expect(findPortalMock).not.toHaveBeenCalled();
  });

  it('returns SESSION_INVALID when the session is valid but the portal row is gone', async () => {
    readSessionMock.mockResolvedValue(SESSION);
    findPortalMock.mockResolvedValue(null);

    const result = await getCurrentSession();

    expect(result).toEqual({ ok: false, reason: 'SESSION_INVALID' });
  });

  it('returns the portal with hubspotPortalId converted to a string (BigInt is not JSON/RSC-safe)', async () => {
    readSessionMock.mockResolvedValue(SESSION);
    findPortalMock.mockResolvedValue({
      id: 'portal-1',
      hubspotPortalId: 9007199254740993n, // exceeds Number.MAX_SAFE_INTEGER
      name: 'Acme',
      hubDomain: 'acme.hubspot.com',
      disconnectedAt: null,
    });
    findUserMock.mockResolvedValue({ id: 'user-1', email: 'a@acme.com', firstName: 'Ada', lastName: 'L' });

    const result = await getCurrentSession();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.portal.hubspotPortalId).toBe('9007199254740993');
    expect(typeof result.portal.hubspotPortalId).toBe('string');
    expect(result.user?.email).toBe('a@acme.com');
  });

  it('scopes the portal lookup to the session\'s own portalId - never a caller-supplied one', async () => {
    readSessionMock.mockResolvedValue(SESSION);
    findPortalMock.mockResolvedValue({
      id: 'portal-1',
      hubspotPortalId: 1n,
      name: null,
      hubDomain: null,
      disconnectedAt: null,
    });
    findUserMock.mockResolvedValue(null);

    await getCurrentSession();

    expect(findPortalMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'portal-1' } }),
    );
  });

  it('surfaces disconnectedAt as-is so callers can show a reconnect banner', async () => {
    const disconnectedAt = new Date('2026-01-01T00:00:00Z');
    readSessionMock.mockResolvedValue(SESSION);
    findPortalMock.mockResolvedValue({
      id: 'portal-1',
      hubspotPortalId: 1n,
      name: 'Acme',
      hubDomain: null,
      disconnectedAt,
    });
    findUserMock.mockResolvedValue(null);

    const result = await getCurrentSession();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.portal.disconnectedAt).toEqual(disconnectedAt);
  });
});
