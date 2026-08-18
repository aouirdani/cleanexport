import { describe, it, expect, vi, beforeEach } from 'vitest';
import Stripe from 'stripe';

// POST /api/webhooks/stripe - specs/07-TASKS.md T20.
//
// THE SECURITY REQUIREMENT under test: signature verification runs before
// anything is parsed or persisted. This file uses a REAL Stripe instance's
// `webhooks` module (no network call - HMAC signing/verification is local)
// to generate genuinely valid and genuinely invalid signatures, rather than
// mocking `constructEvent` to always succeed - a mocked verifier would prove
// nothing about whether the route actually verifies anything.
//
// lib/billing.ts's event handlers ARE mocked here: this file only tests the
// route's own auth-boundary behaviour (verify -> dispatch), not the sync
// logic itself (covered by tests/lib/billing.test.ts).

const WEBHOOK_SECRET = 'whsec_test_secret_for_this_suite';

const {
  handleCheckoutSessionCompletedMock,
  syncSubscriptionFromStripeObjectMock,
  handleSubscriptionDeletedMock,
  handleInvoicePaymentFailedMock,
} = vi.hoisted(() => ({
  handleCheckoutSessionCompletedMock: vi.fn(),
  syncSubscriptionFromStripeObjectMock: vi.fn(),
  handleSubscriptionDeletedMock: vi.fn(),
  handleInvoicePaymentFailedMock: vi.fn(),
}));

vi.mock('@/lib/billing', () => ({
  handleCheckoutSessionCompleted: handleCheckoutSessionCompletedMock,
  syncSubscriptionFromStripeObject: syncSubscriptionFromStripeObjectMock,
  handleSubscriptionDeleted: handleSubscriptionDeletedMock,
  handleInvoicePaymentFailed: handleInvoicePaymentFailedMock,
}));

const { POST } = await import('@/app/api/webhooks/stripe/route');

// A real (offline) Stripe instance purely for its webhooks helper - no API
// calls are made by anything in this file.
const stripeForSigning = new Stripe('sk_test_dummy_key_never_used_for_a_real_call');

function signedRequest(payload: string, opts: { secret?: string; signature?: string } = {}): Request {
  const signature =
    opts.signature ??
    stripeForSigning.webhooks.generateTestHeaderString({ payload, secret: opts.secret ?? WEBHOOK_SECRET });
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    body: payload,
    headers: signature ? { 'stripe-signature': signature } : {},
  });
}

function eventPayload(type: string, object: unknown, id = `evt_${Math.random().toString(36).slice(2)}`): string {
  return JSON.stringify({ id, type, data: { object } });
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key_never_used_for_a_real_call';
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  handleCheckoutSessionCompletedMock.mockReset().mockResolvedValue(undefined);
  syncSubscriptionFromStripeObjectMock.mockReset().mockResolvedValue(undefined);
  handleSubscriptionDeletedMock.mockReset().mockResolvedValue(undefined);
  handleInvoicePaymentFailedMock.mockReset().mockResolvedValue(undefined);
});

describe('POST /api/webhooks/stripe - signature verification runs before anything else', () => {
  it('rejects a request with a bad signature with 400, and calls no handler at all', async () => {
    const payload = eventPayload('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' });
    const req = signedRequest(payload, { signature: 't=1700000000,v1=0000000000000000000000000000000000000000000000000000000000000000' });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(syncSubscriptionFromStripeObjectMock).not.toHaveBeenCalled();
    expect(handleCheckoutSessionCompletedMock).not.toHaveBeenCalled();
    expect(handleSubscriptionDeletedMock).not.toHaveBeenCalled();
    expect(handleInvoicePaymentFailedMock).not.toHaveBeenCalled();
  });

  it('rejects a request signed with the WRONG secret (simulates an attacker who does not know it)', async () => {
    const payload = eventPayload('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' });
    const req = signedRequest(payload, { secret: 'whsec_attacker_does_not_know_the_real_one' });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(syncSubscriptionFromStripeObjectMock).not.toHaveBeenCalled();
  });

  it('rejects a request with a valid signature for a DIFFERENT payload (tampered body after signing)', async () => {
    const originalPayload = eventPayload('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' });
    const signature = stripeForSigning.webhooks.generateTestHeaderString({ payload: originalPayload, secret: WEBHOOK_SECRET });
    const tamperedPayload = eventPayload('customer.subscription.updated', { id: 'sub_1', customer: 'cus_ATTACKER_SUBSTITUTED' });

    const req = new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      body: tamperedPayload,
      headers: { 'stripe-signature': signature },
    });
    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(syncSubscriptionFromStripeObjectMock).not.toHaveBeenCalled();
  });

  it('rejects a request with no stripe-signature header at all', async () => {
    const payload = eventPayload('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' });
    const req = new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body: payload });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(syncSubscriptionFromStripeObjectMock).not.toHaveBeenCalled();
  });

  it('a validly signed request is accepted (200) and dispatches to the matching handler', async () => {
    const payload = eventPayload('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' });
    const req = signedRequest(payload);

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(syncSubscriptionFromStripeObjectMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/webhooks/stripe - event dispatch', () => {
  it('checkout.session.completed -> handleCheckoutSessionCompleted', async () => {
    const payload = eventPayload('checkout.session.completed', { id: 'cs_1', customer: 'cus_1', subscription: 'sub_1' });
    const res = await POST(signedRequest(payload));

    expect(res.status).toBe(200);
    expect(handleCheckoutSessionCompletedMock).toHaveBeenCalledTimes(1);
    const [, session] = handleCheckoutSessionCompletedMock.mock.calls[0];
    expect(session).toMatchObject({ id: 'cs_1', customer: 'cus_1' });
  });

  it('customer.subscription.updated -> syncSubscriptionFromStripeObject', async () => {
    const payload = eventPayload('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1', status: 'active' });
    const res = await POST(signedRequest(payload));

    expect(res.status).toBe(200);
    expect(syncSubscriptionFromStripeObjectMock).toHaveBeenCalledTimes(1);
  });

  it('customer.subscription.deleted -> handleSubscriptionDeleted', async () => {
    const payload = eventPayload('customer.subscription.deleted', { id: 'sub_1', customer: 'cus_1', status: 'canceled' });
    const res = await POST(signedRequest(payload));

    expect(res.status).toBe(200);
    expect(handleSubscriptionDeletedMock).toHaveBeenCalledTimes(1);
  });

  it('invoice.payment_failed -> handleInvoicePaymentFailed', async () => {
    const payload = eventPayload('invoice.payment_failed', { id: 'in_1', customer: 'cus_1' });
    const res = await POST(signedRequest(payload));

    expect(res.status).toBe(200);
    expect(handleInvoicePaymentFailedMock).toHaveBeenCalledTimes(1);
  });

  it('an event type not in the handled list is acknowledged (200) but calls no handler', async () => {
    const payload = eventPayload('payment_intent.succeeded', { id: 'pi_1' });
    const res = await POST(signedRequest(payload));

    expect(res.status).toBe(200);
    expect(handleCheckoutSessionCompletedMock).not.toHaveBeenCalled();
    expect(syncSubscriptionFromStripeObjectMock).not.toHaveBeenCalled();
    expect(handleSubscriptionDeletedMock).not.toHaveBeenCalled();
    expect(handleInvoicePaymentFailedMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/stripe - idempotency: the same event delivered twice', () => {
  it('calls the handler twice without erroring - retried delivery is accepted, not rejected', async () => {
    const payload = eventPayload('customer.subscription.updated', { id: 'sub_1', customer: 'cus_1' }, 'evt_fixed_id');

    const res1 = await POST(signedRequest(payload));
    const res2 = await POST(signedRequest(payload));

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(syncSubscriptionFromStripeObjectMock).toHaveBeenCalledTimes(2);
    // Both calls carry the identical event data - lib/billing.ts's handler
    // (tested directly in tests/lib/billing.test.ts) is what guarantees
    // applying it twice converges to the same state rather than doubling it.
    expect(syncSubscriptionFromStripeObjectMock.mock.calls[0]).toEqual(syncSubscriptionFromStripeObjectMock.mock.calls[1]);
  });
});
