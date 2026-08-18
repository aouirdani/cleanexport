import { describe, it, expect, vi, beforeEach } from 'vitest';

// POST /api/billing/checkout - specs/06-API-CONTRACT.md, specs/07-TASKS.md T20.

const { readSessionMock } = vi.hoisted(() => ({ readSessionMock: vi.fn() }));
vi.mock('@/lib/session', () => ({ readSession: readSessionMock }));

const { stripeClientMock, appUrlMock } = vi.hoisted(() => ({
  stripeClientMock: vi.fn(() => ({ __fakeStripe: true })),
  appUrlMock: vi.fn(() => 'https://app.example.com'),
}));
vi.mock('@/lib/stripe', () => ({ stripeClient: stripeClientMock, appUrl: appUrlMock }));

const { ensureStripeCustomerForPortalMock, createCheckoutSessionMock } = vi.hoisted(() => ({
  ensureStripeCustomerForPortalMock: vi.fn(),
  createCheckoutSessionMock: vi.fn(),
}));
vi.mock('@/lib/billing', () => ({
  ensureStripeCustomerForPortal: ensureStripeCustomerForPortalMock,
  createCheckoutSession: createCheckoutSessionMock,
}));

const { POST } = await import('@/app/api/billing/checkout/route');

const SESSION = { portalId: 'portal-1', hubspotPortalId: '999', userId: 'user-1', issuedAt: Date.now() };

function req(body: unknown) {
  return new Request('http://localhost/api/billing/checkout', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  readSessionMock.mockReset();
  ensureStripeCustomerForPortalMock.mockReset();
  createCheckoutSessionMock.mockReset();

  readSessionMock.mockResolvedValue(SESSION);
  ensureStripeCustomerForPortalMock.mockResolvedValue('cus_1');
  createCheckoutSessionMock.mockResolvedValue({ url: 'https://checkout.stripe.com/session-url' });
});

describe('POST /api/billing/checkout', () => {
  it('401s when there is no session', async () => {
    readSessionMock.mockResolvedValue(null);

    const res = await POST(req({ plan: 'monthly' }));

    expect(res.status).toBe(401);
    expect(ensureStripeCustomerForPortalMock).not.toHaveBeenCalled();
  });

  it('400s on malformed JSON', async () => {
    const res = await POST(new Request('http://localhost/api/billing/checkout', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });

  it('400s on an invalid plan', async () => {
    const res = await POST(req({ plan: 'weekly' }));
    expect(res.status).toBe(400);
    expect(ensureStripeCustomerForPortalMock).not.toHaveBeenCalled();
  });

  it('uses the session\'s portalId/hubspotPortalId, never anything from the body', async () => {
    await POST(req({ plan: 'monthly', portalId: 'someone-elses-portal' }));

    expect(ensureStripeCustomerForPortalMock).toHaveBeenCalledWith(expect.anything(), 'portal-1', '999');
  });

  it('creates a Checkout Session for the chosen plan and returns its URL', async () => {
    const res = await POST(req({ plan: 'yearly' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ url: 'https://checkout.stripe.com/session-url' });
    expect(createCheckoutSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ stripeCustomerId: 'cus_1', plan: 'yearly' }),
    );
  });

  it('502s if Stripe somehow returns no URL', async () => {
    createCheckoutSessionMock.mockResolvedValue({ url: null });

    const res = await POST(req({ plan: 'monthly' }));

    expect(res.status).toBe(502);
  });
});
