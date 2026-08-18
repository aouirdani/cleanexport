import { describe, it, expect, vi, beforeEach } from 'vitest';

// POST /api/billing/portal - specs/06-API-CONTRACT.md, specs/07-TASKS.md T20.

const { readSessionMock } = vi.hoisted(() => ({ readSessionMock: vi.fn() }));
vi.mock('@/lib/session', () => ({ readSession: readSessionMock }));

const { stripeClientMock, appUrlMock } = vi.hoisted(() => ({
  stripeClientMock: vi.fn(() => ({ __fakeStripe: true })),
  appUrlMock: vi.fn(() => 'https://app.example.com'),
}));
vi.mock('@/lib/stripe', () => ({ stripeClient: stripeClientMock, appUrl: appUrlMock }));

const { getSubscriptionForPortalMock, createPortalSessionMock } = vi.hoisted(() => ({
  getSubscriptionForPortalMock: vi.fn(),
  createPortalSessionMock: vi.fn(),
}));
vi.mock('@/lib/billing', () => ({
  getSubscriptionForPortal: getSubscriptionForPortalMock,
  createPortalSession: createPortalSessionMock,
}));

const { POST } = await import('@/app/api/billing/portal/route');

const SESSION = { portalId: 'portal-1', hubspotPortalId: '999', userId: 'user-1', issuedAt: Date.now() };

beforeEach(() => {
  readSessionMock.mockReset();
  getSubscriptionForPortalMock.mockReset();
  createPortalSessionMock.mockReset();

  readSessionMock.mockResolvedValue(SESSION);
  getSubscriptionForPortalMock.mockResolvedValue({ portalId: 'portal-1', stripeCustomerId: 'cus_1' });
  createPortalSessionMock.mockResolvedValue({ url: 'https://billing.stripe.com/session-url' });
});

describe('POST /api/billing/portal', () => {
  it('401s when there is no session', async () => {
    readSessionMock.mockResolvedValue(null);

    const res = await POST();

    expect(res.status).toBe(401);
    expect(getSubscriptionForPortalMock).not.toHaveBeenCalled();
  });

  it('404s when the portal has no subscription yet (never started checkout)', async () => {
    getSubscriptionForPortalMock.mockResolvedValue(null);

    const res = await POST();

    expect(res.status).toBe(404);
    expect(createPortalSessionMock).not.toHaveBeenCalled();
  });

  it('looks up the subscription for the session\'s own portalId', async () => {
    await POST();
    expect(getSubscriptionForPortalMock).toHaveBeenCalledWith('portal-1');
  });

  it('creates a portal session for the stored stripeCustomerId and returns its URL', async () => {
    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ url: 'https://billing.stripe.com/session-url' });
    expect(createPortalSessionMock).toHaveBeenCalledWith(expect.objectContaining({ stripeCustomerId: 'cus_1' }));
  });
});
