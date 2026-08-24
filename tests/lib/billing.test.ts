import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Stripe from 'stripe';

// lib/billing.ts - specs/07-TASKS.md T20. No live Stripe or DB: prisma is a
// small stateful fake (Subscription keyed by portalId AND stripeCustomerId,
// like the real unique constraints), and Stripe is a fake client with only
// the methods lib/billing.ts actually calls.

interface FakeSubscription {
  portalId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

function makeFakePrisma(seed: FakeSubscription[] = []) {
  const byPortalId = new Map(seed.map((s) => [s.portalId, { ...s }]));

  return {
    subscription: {
      findUnique: vi.fn(async ({ where }: { where: { portalId?: string; stripeCustomerId?: string } }) => {
        if (where.portalId) return byPortalId.get(where.portalId) ? { ...byPortalId.get(where.portalId)! } : null;
        if (where.stripeCustomerId) {
          const found = [...byPortalId.values()].find((s) => s.stripeCustomerId === where.stripeCustomerId);
          return found ? { ...found } : null;
        }
        return null;
      }),
      create: vi.fn(async ({ data }: { data: Partial<FakeSubscription> & { portalId: string; stripeCustomerId: string } }) => {
        if (byPortalId.has(data.portalId)) throw new Error('fake prisma: unique constraint violation on portalId');
        const row: FakeSubscription = {
          portalId: data.portalId,
          stripeCustomerId: data.stripeCustomerId,
          stripeSubscriptionId: data.stripeSubscriptionId ?? null,
          status: data.status ?? 'TRIALING',
          trialEndsAt: data.trialEndsAt ?? null,
          currentPeriodEnd: data.currentPeriodEnd ?? null,
          cancelAtPeriodEnd: data.cancelAtPeriodEnd ?? false,
        };
        byPortalId.set(row.portalId, row);
        return { ...row };
      }),
      update: vi.fn(async ({ where, data }: { where: { portalId: string }; data: Partial<FakeSubscription> }) => {
        const existing = byPortalId.get(where.portalId);
        if (!existing) throw new Error('fake prisma: row not found');
        const updated = { ...existing, ...data };
        byPortalId.set(where.portalId, updated);
        return { ...updated };
      }),
    },
    state: { byPortalId },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;
let fakePrisma: FakePrisma;

vi.mock('@/lib/db', () => ({ prisma: undefined }));

async function setPrisma(p: FakePrisma) {
  const dbModule = await import('@/lib/db');
  (dbModule as unknown as { prisma: FakePrisma }).prisma = p;
}

beforeEach(() => {
  process.env.STRIPE_PRICE_ID_MONTHLY = 'price_monthly_test';
  process.env.STRIPE_PRICE_ID_YEARLY = 'price_yearly_test';
});

const {
  mapStripeStatus,
  ensureStripeCustomerForPortal,
  getSubscriptionForPortal,
  syncSubscriptionFromStripeObject,
  handleSubscriptionDeleted,
  handleInvoicePaymentFailed,
  handleCheckoutSessionCompleted,
  createCheckoutSession,
  createPortalSession,
} = await import('@/lib/billing');

describe('mapStripeStatus', () => {
  it.each([
    ['trialing', 'TRIALING'],
    ['active', 'ACTIVE'],
    ['past_due', 'PAST_DUE'],
    ['unpaid', 'PAST_DUE'],
    ['incomplete', 'PAST_DUE'],
    ['paused', 'PAST_DUE'],
    ['canceled', 'CANCELED'],
    ['incomplete_expired', 'CANCELED'],
  ])('%s -> %s', (stripeStatus, expected) => {
    expect(mapStripeStatus(stripeStatus as Stripe.Subscription.Status)).toBe(expected);
  });

  it('an unrecognised/future status is treated as needing attention (PAST_DUE), never silently ACTIVE', () => {
    expect(mapStripeStatus('some_future_status' as Stripe.Subscription.Status)).toBe('PAST_DUE');
  });
});

describe('ensureStripeCustomerForPortal', () => {
  it('creates a new Stripe customer and a TRIALING Subscription row when none exists', async () => {
    fakePrisma = makeFakePrisma([]);
    await setPrisma(fakePrisma);
    const create = vi.fn().mockResolvedValue({ id: 'cus_new' });
    const stripe = { customers: { create } } as unknown as Stripe;

    const customerId = await ensureStripeCustomerForPortal(stripe, 'portal-1', '999');

    expect(customerId).toBe('cus_new');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ metadata: { portalId: 'portal-1', hubspotPortalId: '999' } }));
    expect(fakePrisma.state.byPortalId.get('portal-1')).toMatchObject({ stripeCustomerId: 'cus_new', status: 'TRIALING' });
  });

  it('reuses an existing customer id and does not call Stripe again', async () => {
    fakePrisma = makeFakePrisma([
      { portalId: 'portal-1', stripeCustomerId: 'cus_existing', stripeSubscriptionId: null, status: 'TRIALING', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    ]);
    await setPrisma(fakePrisma);
    const create = vi.fn();
    const stripe = { customers: { create } } as unknown as Stripe;

    const customerId = await ensureStripeCustomerForPortal(stripe, 'portal-1', '999');

    expect(customerId).toBe('cus_existing');
    expect(create).not.toHaveBeenCalled();
  });

  it('is safe to call twice in a row (e.g. a double-click) - only ever one customer/row per portal', async () => {
    fakePrisma = makeFakePrisma([]);
    await setPrisma(fakePrisma);
    const create = vi.fn().mockResolvedValue({ id: 'cus_new' });
    const stripe = { customers: { create } } as unknown as Stripe;

    const first = await ensureStripeCustomerForPortal(stripe, 'portal-1', '999');
    const second = await ensureStripeCustomerForPortal(stripe, 'portal-1', '999');

    expect(first).toBe(second);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('getSubscriptionForPortal', () => {
  it('returns null for a portal with no subscription row', async () => {
    fakePrisma = makeFakePrisma([]);
    await setPrisma(fakePrisma);
    expect(await getSubscriptionForPortal('portal-1')).toBeNull();
  });
});

function fakeSubscriptionObject(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    trial_end: null,
    cancel_at_period_end: false,
    items: { data: [{ current_period_end: 1_800_000_000 }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

describe('syncSubscriptionFromStripeObject - THE PORTAL IS RESOLVED FROM OUR STORED CUSTOMER ID, never trusted from the event', () => {
  it('a customer id we never created (no matching Subscription row) is a no-op, not an error', async () => {
    fakePrisma = makeFakePrisma([]);
    await setPrisma(fakePrisma);

    await expect(syncSubscriptionFromStripeObject(fakeSubscriptionObject({ customer: 'cus_unknown' }))).resolves.toBeUndefined();
    expect(fakePrisma.subscription.update).not.toHaveBeenCalled();
  });

  it('updates the portal whose stored stripeCustomerId matches the event\'s customer, by that lookup alone', async () => {
    fakePrisma = makeFakePrisma([
      { portalId: 'portal-1', stripeCustomerId: 'cus_1', stripeSubscriptionId: null, status: 'TRIALING', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    ]);
    await setPrisma(fakePrisma);

    await syncSubscriptionFromStripeObject(fakeSubscriptionObject({ status: 'active' }));

    expect(fakePrisma.state.byPortalId.get('portal-1')).toMatchObject({ status: 'ACTIVE', stripeSubscriptionId: 'sub_1' });
  });

  it('sets trialEndsAt and currentPeriodEnd from the event\'s unix timestamps', async () => {
    fakePrisma = makeFakePrisma([
      { portalId: 'portal-1', stripeCustomerId: 'cus_1', stripeSubscriptionId: null, status: 'TRIALING', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    ]);
    await setPrisma(fakePrisma);

    await syncSubscriptionFromStripeObject(
      fakeSubscriptionObject({ status: 'trialing', trial_end: 1_700_000_000, items: { data: [{ current_period_end: 1_800_000_000 }] } as never }),
    );

    const row = fakePrisma.state.byPortalId.get('portal-1')!;
    expect(row.trialEndsAt).toEqual(new Date(1_700_000_000 * 1000));
    expect(row.currentPeriodEnd).toEqual(new Date(1_800_000_000 * 1000));
  });

  it('reads current_period_end from the subscription ITEM, not the (removed) top-level field', async () => {
    fakePrisma = makeFakePrisma([
      { portalId: 'portal-1', stripeCustomerId: 'cus_1', stripeSubscriptionId: null, status: 'TRIALING', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    ]);
    await setPrisma(fakePrisma);

    const sub = { ...fakeSubscriptionObject(), current_period_end: 999 } as unknown as Stripe.Subscription; // a stray top-level field, must be ignored
    await syncSubscriptionFromStripeObject(sub);

    expect(fakePrisma.state.byPortalId.get('portal-1')!.currentPeriodEnd).toEqual(new Date(1_800_000_000 * 1000));
  });

  // Cancelling in the Customer Portal sets cancel_at_period_end on the
  // subscription and fires customer.subscription.updated (NOT .deleted,
  // which only fires once the period actually ends) - this must be
  // persisted so the banner can tell the customer it worked, instead of
  // showing the same countdown as before the cancellation.
  it('persists cancel_at_period_end true from a subscription.updated-shaped event, without changing status', async () => {
    fakePrisma = makeFakePrisma([
      { portalId: 'portal-1', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    ]);
    await setPrisma(fakePrisma);

    await syncSubscriptionFromStripeObject(fakeSubscriptionObject({ status: 'active', cancel_at_period_end: true }));

    expect(fakePrisma.state.byPortalId.get('portal-1')).toMatchObject({ status: 'ACTIVE', cancelAtPeriodEnd: true });
  });

  it('a later event with cancel_at_period_end false (resumed via the portal) clears it back', async () => {
    fakePrisma = makeFakePrisma([
      { portalId: 'portal-1', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: true },
    ]);
    await setPrisma(fakePrisma);

    await syncSubscriptionFromStripeObject(fakeSubscriptionObject({ status: 'active', cancel_at_period_end: false }));

    expect(fakePrisma.state.byPortalId.get('portal-1')).toMatchObject({ cancelAtPeriodEnd: false });
  });

  it('IDEMPOTENT: applying the identical event twice leaves the row in the exact same state, not doubled', async () => {
    fakePrisma = makeFakePrisma([
      { portalId: 'portal-1', stripeCustomerId: 'cus_1', stripeSubscriptionId: null, status: 'TRIALING', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    ]);
    await setPrisma(fakePrisma);
    const event = fakeSubscriptionObject({ status: 'active', trial_end: 1_700_000_000 });

    await syncSubscriptionFromStripeObject(event);
    const afterFirst = { ...fakePrisma.state.byPortalId.get('portal-1')! };
    await syncSubscriptionFromStripeObject(event); // Stripe redelivers the same event
    const afterSecond = fakePrisma.state.byPortalId.get('portal-1')!;

    expect(afterSecond).toEqual(afterFirst);
    expect(fakePrisma.subscription.update).toHaveBeenCalledTimes(2); // called twice, same effect both times
  });
});

describe('handleSubscriptionDeleted', () => {
  it('sets status CANCELED, resolved by stored customer id', async () => {
    fakePrisma = makeFakePrisma([
      { portalId: 'portal-1', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: new Date(), cancelAtPeriodEnd: false },
    ]);
    await setPrisma(fakePrisma);

    await handleSubscriptionDeleted(fakeSubscriptionObject({ status: 'canceled' }));

    expect(fakePrisma.state.byPortalId.get('portal-1')!.status).toBe('CANCELED');
  });

  it('an unknown customer id is a no-op', async () => {
    fakePrisma = makeFakePrisma([]);
    await setPrisma(fakePrisma);
    await expect(handleSubscriptionDeleted(fakeSubscriptionObject())).resolves.toBeUndefined();
    expect(fakePrisma.subscription.update).not.toHaveBeenCalled();
  });

  it('IDEMPOTENT: applying it twice is still just CANCELED', async () => {
    fakePrisma = makeFakePrisma([
      { portalId: 'portal-1', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    ]);
    await setPrisma(fakePrisma);
    const event = fakeSubscriptionObject({ status: 'canceled' });

    await handleSubscriptionDeleted(event);
    await handleSubscriptionDeleted(event);

    expect(fakePrisma.state.byPortalId.get('portal-1')!.status).toBe('CANCELED');
  });
});

function fakeInvoiceObject(overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice {
  return { id: 'in_1', customer: 'cus_1', ...overrides } as unknown as Stripe.Invoice;
}

describe('handleInvoicePaymentFailed', () => {
  it('sets status PAST_DUE, resolved by stored customer id', async () => {
    fakePrisma = makeFakePrisma([
      { portalId: 'portal-1', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    ]);
    await setPrisma(fakePrisma);

    await handleInvoicePaymentFailed(fakeInvoiceObject());

    expect(fakePrisma.state.byPortalId.get('portal-1')!.status).toBe('PAST_DUE');
  });

  it('an unknown customer id is a no-op', async () => {
    fakePrisma = makeFakePrisma([]);
    await setPrisma(fakePrisma);
    await expect(handleInvoicePaymentFailed(fakeInvoiceObject({ customer: 'cus_unknown' }))).resolves.toBeUndefined();
    expect(fakePrisma.subscription.update).not.toHaveBeenCalled();
  });
});

describe('handleCheckoutSessionCompleted', () => {
  it('retrieves the authoritative subscription and syncs from it, resolved by stored customer id', async () => {
    fakePrisma = makeFakePrisma([
      { portalId: 'portal-1', stripeCustomerId: 'cus_1', stripeSubscriptionId: null, status: 'TRIALING', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    ]);
    await setPrisma(fakePrisma);
    const retrieve = vi.fn().mockResolvedValue(fakeSubscriptionObject({ status: 'trialing', trial_end: 1_700_000_000 }));
    const stripe = { subscriptions: { retrieve } } as unknown as Stripe;
    const session = { customer: 'cus_1', subscription: 'sub_1' } as unknown as Stripe.Checkout.Session;

    await handleCheckoutSessionCompleted(stripe, session);

    expect(retrieve).toHaveBeenCalledWith('sub_1');
    expect(fakePrisma.state.byPortalId.get('portal-1')).toMatchObject({ status: 'TRIALING', stripeSubscriptionId: 'sub_1' });
  });

  it('an unknown customer id never calls Stripe to retrieve the subscription', async () => {
    fakePrisma = makeFakePrisma([]);
    await setPrisma(fakePrisma);
    const retrieve = vi.fn();
    const stripe = { subscriptions: { retrieve } } as unknown as Stripe;
    const session = { customer: 'cus_unknown', subscription: 'sub_1' } as unknown as Stripe.Checkout.Session;

    await handleCheckoutSessionCompleted(stripe, session);

    expect(retrieve).not.toHaveBeenCalled();
  });

  it('a session with no subscription id is a no-op', async () => {
    fakePrisma = makeFakePrisma([
      { portalId: 'portal-1', stripeCustomerId: 'cus_1', stripeSubscriptionId: null, status: 'TRIALING', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    ]);
    await setPrisma(fakePrisma);
    const retrieve = vi.fn();
    const stripe = { subscriptions: { retrieve } } as unknown as Stripe;
    const session = { customer: 'cus_1', subscription: null } as unknown as Stripe.Checkout.Session;

    await handleCheckoutSessionCompleted(stripe, session);

    expect(retrieve).not.toHaveBeenCalled();
  });
});

describe('createPortalSession - thin Stripe wrapper', () => {
  it('points at the given customer and return URL', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'bps_1', url: 'https://billing.stripe.com/x' });
    const stripe = { billingPortal: { sessions: { create } } } as unknown as Stripe;

    await createPortalSession({ stripe, stripeCustomerId: 'cus_1', returnUrl: 'https://app.example.com/dashboard' });

    expect(create).toHaveBeenCalledWith({ customer: 'cus_1', return_url: 'https://app.example.com/dashboard' });
  });
});

// The incident: "five subscriptions exist for two email addresses" -
// createCheckoutSession created a brand-new Stripe subscription (with its
// own fresh 14-day trial) on every call, never checking whether the
// portal already had one. Two independent fixes, tested separately below:
//   1. An existing LIVE (per Stripe, not our cached row) trialing/active/
//      past_due subscription short-circuits to the Customer Portal - no
//      new Checkout session, ever.
//   2. A portal that has EVER completed a checkout before (stripeSubscriptionId
//      set, regardless of current status) never gets a second real trial.
describe('createCheckoutSession - never a duplicate subscription, never a second trial', () => {
  function stripeStub(opts: {
    retrieve?: ReturnType<typeof vi.fn>;
    checkoutCreate?: ReturnType<typeof vi.fn>;
    portalCreate?: ReturnType<typeof vi.fn>;
  }) {
    return {
      subscriptions: { retrieve: opts.retrieve ?? vi.fn() },
      checkout: { sessions: { create: opts.checkoutCreate ?? vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/x' }) } },
      billingPortal: { sessions: { create: opts.portalCreate ?? vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/x' }) } },
    } as unknown as Stripe;
  }

  const BASE_OPTS = {
    portalId: 'portal-1',
    stripeCustomerId: 'cus_1',
    plan: 'monthly' as const,
    successUrl: 'https://app.example.com/success',
    cancelUrl: 'https://app.example.com/cancel',
    returnUrl: 'https://app.example.com/dashboard',
  };

  it('no Subscription row at all (never checked out): creates a Checkout session with a full 14-day trial', async () => {
    fakePrisma = makeFakePrisma([]);
    await setPrisma(fakePrisma);
    const checkoutCreate = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/x' });
    const stripe = stripeStub({ checkoutCreate });

    const result = await createCheckoutSession({ ...BASE_OPTS, stripe });

    expect(result).toEqual({ url: 'https://checkout.stripe.com/x' });
    expect(checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({ subscription_data: { trial_period_days: 14 } }),
    );
  });

  it('a Subscription row exists but has never completed a checkout (stripeSubscriptionId null): still a full 14-day trial, and Stripe is never asked for a live status', async () => {
    fakePrisma = makeFakePrisma([
      { portalId: 'portal-1', stripeCustomerId: 'cus_1', stripeSubscriptionId: null, status: 'TRIALING', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    ]);
    await setPrisma(fakePrisma);
    const retrieve = vi.fn();
    const checkoutCreate = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/x' });
    const stripe = stripeStub({ retrieve, checkoutCreate });

    await createCheckoutSession({ ...BASE_OPTS, stripe });

    expect(retrieve).not.toHaveBeenCalled();
    expect(checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({ subscription_data: { trial_period_days: 14 } }),
    );
  });

  it.each(['trialing', 'active', 'past_due'] as const)(
    'an existing subscription that is LIVE %s in Stripe: returns the Customer Portal URL, never creates a Checkout session',
    async (liveStatus) => {
      fakePrisma = makeFakePrisma([
        { portalId: 'portal-1', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_existing', status: 'TRIALING', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
      ]);
      await setPrisma(fakePrisma);
      const retrieve = vi.fn().mockResolvedValue({ id: 'sub_existing', status: liveStatus });
      const checkoutCreate = vi.fn();
      const portalCreate = vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/manage' });
      const stripe = stripeStub({ retrieve, checkoutCreate, portalCreate });

      const result = await createCheckoutSession({ ...BASE_OPTS, stripe });

      expect(retrieve).toHaveBeenCalledWith('sub_existing');
      expect(checkoutCreate).not.toHaveBeenCalled();
      expect(portalCreate).toHaveBeenCalledWith(
        expect.objectContaining({ customer: 'cus_1', return_url: 'https://app.example.com/dashboard' }),
      );
      expect(result).toEqual({ url: 'https://billing.stripe.com/manage' });
    },
  );

  it('an existing subscription that is CANCELED in Stripe: creates a NEW Checkout session, but with trial_period_days 0 - already used a trial once', async () => {
    fakePrisma = makeFakePrisma([
      { portalId: 'portal-1', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_old', status: 'CANCELED', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    ]);
    await setPrisma(fakePrisma);
    const retrieve = vi.fn().mockResolvedValue({ id: 'sub_old', status: 'canceled' });
    const checkoutCreate = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/x' });
    const portalCreate = vi.fn();
    const stripe = stripeStub({ retrieve, checkoutCreate, portalCreate });

    const result = await createCheckoutSession({ ...BASE_OPTS, stripe });

    expect(portalCreate).not.toHaveBeenCalled();
    expect(checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({ subscription_data: { trial_period_days: 0 } }),
    );
    expect(result).toEqual({ url: 'https://checkout.stripe.com/x' });
  });

  it('Stripe fails to retrieve the existing subscription (e.g. deleted, or a network error): falls back to a new Checkout session, still with no second trial', async () => {
    fakePrisma = makeFakePrisma([
      { portalId: 'portal-1', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_gone', status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    ]);
    await setPrisma(fakePrisma);
    const retrieve = vi.fn().mockRejectedValue(new Error('No such subscription'));
    const checkoutCreate = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/x' });
    const stripe = stripeStub({ retrieve, checkoutCreate });

    const result = await createCheckoutSession({ ...BASE_OPTS, stripe });

    expect(checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({ subscription_data: { trial_period_days: 0 } }),
    );
    expect(result).toEqual({ url: 'https://checkout.stripe.com/x' });
  });

  it('requests the right price for the chosen plan', async () => {
    fakePrisma = makeFakePrisma([]);
    await setPrisma(fakePrisma);
    const checkoutCreate = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/x' });
    const stripe = stripeStub({ checkoutCreate });

    await createCheckoutSession({ ...BASE_OPTS, plan: 'yearly', stripe });

    expect(checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer: 'cus_1',
        line_items: [{ price: 'price_yearly_test', quantity: 1 }],
      }),
    );
  });

  it('two rapid calls against an existing live subscription both resolve to the portal - never two Checkout sessions, never a second subscription', async () => {
    fakePrisma = makeFakePrisma([
      { portalId: 'portal-1', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_existing', status: 'TRIALING', trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false },
    ]);
    await setPrisma(fakePrisma);
    const retrieve = vi.fn().mockResolvedValue({ id: 'sub_existing', status: 'trialing' });
    const checkoutCreate = vi.fn();
    const portalCreate = vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/manage' });
    const stripe = stripeStub({ retrieve, checkoutCreate, portalCreate });

    const [first, second] = await Promise.all([
      createCheckoutSession({ ...BASE_OPTS, stripe }),
      createCheckoutSession({ ...BASE_OPTS, stripe }),
    ]);

    expect(checkoutCreate).not.toHaveBeenCalled();
    expect(first).toEqual({ url: 'https://billing.stripe.com/manage' });
    expect(second).toEqual({ url: 'https://billing.stripe.com/manage' });
  });
});
