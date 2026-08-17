import { describe, it, expect, vi, beforeEach } from 'vitest';

// GET /api/auth/session, refactored (specs/07-TASKS.md T16) to read through
// lib/currentPortal.ts's getCurrentSession() so server components share the
// exact same logic. This test pins the response shape/status codes so that
// refactor didn't change the contract in specs/06-API-CONTRACT.md.

const { getCurrentSessionMock } = vi.hoisted(() => ({ getCurrentSessionMock: vi.fn() }));
vi.mock('@/lib/currentPortal', () => ({ getCurrentSession: getCurrentSessionMock }));

const { GET } = await import('@/app/api/auth/session/route');

beforeEach(() => {
  getCurrentSessionMock.mockReset();
});

describe('GET /api/auth/session', () => {
  it('401s with NOT_AUTHENTICATED when there is no session', async () => {
    getCurrentSessionMock.mockResolvedValue({ ok: false, reason: 'NOT_AUTHENTICATED' });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe('NOT_AUTHENTICATED');
  });

  it('401s with SESSION_INVALID when the portal row is gone', async () => {
    getCurrentSessionMock.mockResolvedValue({ ok: false, reason: 'SESSION_INVALID' });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe('SESSION_INVALID');
  });

  it('200s with { portal, user } on a valid session', async () => {
    const portal = { id: 'portal-1', hubspotPortalId: '123', name: 'Acme', hubDomain: 'acme.hubspot.com', disconnectedAt: null };
    const user = { id: 'user-1', email: 'a@acme.com', firstName: 'Ada', lastName: 'L' };
    getCurrentSessionMock.mockResolvedValue({ ok: true, portal, user });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ portal, user });
  });
});
