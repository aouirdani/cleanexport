/**
 * Stripe <-> Subscription sync - specs/07-TASKS.md T20; specs/03-DATA-MODEL.md's
 * Subscription model.
 *
 * THE RULE: a webhook event's own body is Stripe-signed, but the PORTAL it
 * refers to is never read from anything Stripe sends us (no
 * `session.client_reference_id`, no `subscription.metadata.portalId`).
 * Every handler here resolves portalId by looking up OUR OWN
 * `Subscription.stripeCustomerId` (unique) for the customer id in the
 * event, which we ourselves wrote there in `ensureStripeCustomerForPortal`
 * before the customer could ever generate a webhook. An event for a
 * customer id we don't recognise is a no-op, not an error - there is
 * nothing in our database it could correspond to.
 *
 * Idempotency by construction, not by a dedup table: every handler here
 * SETS the Subscription row's fields to the event's current absolute
 * values (status, trialEndsAt, currentPeriodEnd, ...) - never increments,
 * appends, or otherwise depends on prior state. Applying the same event
 * twice (Stripe's delivery is at-least-once) produces the same row both
 * times. specs/03-DATA-MODEL.md: "six tables... a seventh means the agent
 * misunderstood the scope" - a processed-events table isn't needed when
 * the handlers are idempotent on their own.
 */
import type Stripe from 'stripe';
import { prisma } from '@/lib/db';
import { SubStatus } from '@/lib/generated/prisma/client';
import { TRIAL_PERIOD_DAYS, priceIdFor, type BillingPlan } from '@/lib/stripe';

function customerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

async function resolvePortalIdByCustomerId(stripeCustomerId: string): Promise<string | null> {
  const sub = await prisma.subscription.findUnique({
    where: { stripeCustomerId },
    select: { portalId: true },
  });
  return sub?.portalId ?? null;
}

function unixToDate(seconds: number | null | undefined): Date | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}

/**
 * `pastDueSince` marks when `status` most recently BECAME PAST_DUE, not just
 * that it currently is - see prisma/schema.prisma's field comment. Re-syncing
 * PAST_DUE while already PAST_DUE (e.g. a second `invoice.payment_failed` for
 * the same subscription, or an unrelated `customer.subscription.updated`
 * webhook that leaves status unchanged) must not push the clock forward, or
 * lib/plan.ts's grace period would never elapse as long as Stripe keeps
 * retrying. Leaving PAST_DUE for any other status clears it.
 */
function nextPastDueSince(
  previous: { status: SubStatus; pastDueSince: Date | null } | null,
  nextStatus: SubStatus,
): Date | null {
  if (nextStatus !== SubStatus.PAST_DUE) return null;
  if (previous?.status === SubStatus.PAST_DUE) return previous.pastDueSince ?? new Date();
  return new Date();
}

/**
 * Every Stripe subscription status maps to something, including ones this
 * version of the SDK doesn't know about yet (`Stripe.Subscription.Status`
 * includes a forward-compatible `OtherString` case) - never throws, never
 * silently leaves a portal looking ACTIVE for a status we don't recognise.
 */
export function mapStripeStatus(status: Stripe.Subscription.Status): SubStatus {
  switch (status) {
    case 'trialing':
      return SubStatus.TRIALING;
    case 'active':
      return SubStatus.ACTIVE;
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
    case 'paused':
      return SubStatus.PAST_DUE;
    case 'canceled':
    case 'incomplete_expired':
      return SubStatus.CANCELED;
    default:
      // Forward-compat: an unrecognised status is treated as needing
      // attention, never as a silent ACTIVE.
      return SubStatus.PAST_DUE;
  }
}

/**
 * Creates the Stripe Customer for a portal's first checkout, if one doesn't
 * already exist, and persists the portalId<->customerId mapping ourselves
 * (Subscription.stripeCustomerId is NOT NULL - a Subscription row cannot
 * exist before its customer does, so this is necessarily the first write).
 * This is the ONLY place that mapping is created - every webhook handler
 * below only ever READS it back.
 */
export async function ensureStripeCustomerForPortal(
  stripe: Stripe,
  portalId: string,
  hubspotPortalId: string,
): Promise<string> {
  const existing = await prisma.subscription.findUnique({
    where: { portalId },
    select: { stripeCustomerId: true },
  });
  if (existing) return existing.stripeCustomerId;

  const customer = await stripe.customers.create({ metadata: { portalId, hubspotPortalId } });

  await prisma.subscription.create({
    data: { portalId, stripeCustomerId: customer.id, status: SubStatus.TRIALING },
  });

  return customer.id;
}

export async function getSubscriptionForPortal(portalId: string) {
  return prisma.subscription.findUnique({ where: { portalId } });
}

/** Shared by checkout.session.completed and customer.subscription.updated - one writer, one shape. */
export async function syncSubscriptionFromStripeObject(subscription: Stripe.Subscription): Promise<void> {
  const stripeCustomerId = customerId(subscription.customer);
  if (!stripeCustomerId) return;

  const portalId = await resolvePortalIdByCustomerId(stripeCustomerId);
  if (!portalId) return; // a customer we didn't create - nothing of ours to update

  const current = await prisma.subscription.findUnique({
    where: { portalId },
    select: { status: true, pastDueSince: true },
  });

  // current_period_end moved from the Subscription object onto its items in
  // recent Stripe API versions - see node_modules/stripe's SubscriptionItems type.
  const currentPeriodEnd = subscription.items.data[0]?.current_period_end;
  const status = mapStripeStatus(subscription.status);

  await prisma.subscription.update({
    where: { portalId },
    data: {
      stripeSubscriptionId: subscription.id,
      status,
      trialEndsAt: unixToDate(subscription.trial_end),
      currentPeriodEnd: unixToDate(currentPeriodEnd),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      pastDueSince: nextPastDueSince(current, status),
    },
  });
}

export async function handleCheckoutSessionCompleted(stripe: Stripe, session: Stripe.Checkout.Session): Promise<void> {
  const stripeCustomerId = customerId(session.customer);
  if (!stripeCustomerId) return;

  const portalId = await resolvePortalIdByCustomerId(stripeCustomerId);
  if (!portalId) return;

  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  if (!subscriptionId) return;

  // The session itself doesn't carry the subscription's status/trial/period
  // fields unless expanded - retrieve the authoritative object rather than
  // guessing (e.g. assuming ACTIVE, which would be wrong for a trialing sub).
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await syncSubscriptionFromStripeObject(subscription);
}

export async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const stripeCustomerId = customerId(subscription.customer);
  if (!stripeCustomerId) return;

  const portalId = await resolvePortalIdByCustomerId(stripeCustomerId);
  if (!portalId) return;

  await prisma.subscription.update({
    where: { portalId },
    data: {
      status: SubStatus.CANCELED,
      stripeSubscriptionId: subscription.id,
      cancelAtPeriodEnd: false,
      pastDueSince: null,
    },
  });
}

export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const stripeCustomerId = customerId(invoice.customer);
  if (!stripeCustomerId) return;

  const portalId = await resolvePortalIdByCustomerId(stripeCustomerId);
  if (!portalId) return;

  const current = await prisma.subscription.findUnique({
    where: { portalId },
    select: { status: true, pastDueSince: true },
  });

  await prisma.subscription.update({
    where: { portalId },
    data: { status: SubStatus.PAST_DUE, pastDueSince: nextPastDueSince(current, SubStatus.PAST_DUE) },
  });
}

export interface CreateCheckoutSessionOptions {
  stripe: Stripe;
  /** Looked up (not trusted from input) to find any subscription this portal already has. */
  portalId: string;
  stripeCustomerId: string;
  plan: BillingPlan;
  successUrl: string;
  cancelUrl: string;
  /** Where the Customer Portal sends the browser back to - only used when this call resolves to a portal session instead of a new Checkout one. */
  returnUrl: string;
}

/**
 * Stripe subscription statuses that mean "this customer already has a
 * subscription that a NEW Checkout session must not duplicate." Terminal
 * statuses (`canceled`, `incomplete_expired`) are deliberately excluded -
 * a returning customer with nothing live left is exactly who a new
 * Checkout session is for (see `hasUsedTrial` below for what they don't
 * get again: a second trial).
 */
const RENEWABLE_STRIPE_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
  'trialing',
  'active',
  'past_due',
]);

/**
 * Five real Stripe subscriptions existed for two email addresses in test
 * mode before this fix - every "Add payment method" / "Start free trial"
 * click created ANOTHER Checkout Session, and Checkout's `mode:
 * 'subscription'` always creates a brand-new subscription (with its own
 * fresh 14-day trial) rather than attaching to an existing one. Two
 * consequences this closes:
 *   1. A trial can be renewed indefinitely by re-clicking the button -
 *      the customer never pays.
 *   2. Orphaned subscriptions all start billing in parallel once their
 *      trials end, charging the same customer multiple times.
 *
 * The fix has two independent parts:
 *   - If the portal's own Subscription row points at a Stripe subscription
 *     that is CURRENTLY (per Stripe, not our possibly-stale cached status)
 *     trialing/active/past_due, no new Checkout session is created at all -
 *     the Customer Portal URL is returned instead, so "adding a payment
 *     method" attaches to THAT subscription (Stripe's own portal flow),
 *     never starts a second one.
 *   - Otherwise, a new Checkout session IS created, but only gets a real
 *     trial if this portal has never had a stripeSubscriptionId before.
 *     `stripeSubscriptionId` is set once by `syncSubscriptionFromStripeObject`
 *     on the first completed checkout and is never cleared afterwards
 *     (`handleSubscriptionDeleted` keeps it) - its mere presence is a
 *     durable "has this portal EVER completed a checkout" flag, with no
 *     extra schema field needed.
 */
export async function createCheckoutSession(opts: CreateCheckoutSessionOptions): Promise<{ url: string | null }> {
  const existing = await prisma.subscription.findUnique({
    where: { portalId: opts.portalId },
    select: { stripeSubscriptionId: true },
  });

  if (existing?.stripeSubscriptionId) {
    // Re-verified against Stripe directly, not our own cached `status`:
    // ours can be stale in either direction (a webhook not yet processed,
    // or one we never received) - trusting a stale TRIALING would wrongly
    // block a genuinely-lapsed customer from starting over, and trusting
    // a stale CANCELED would wrongly let a still-live customer duplicate.
    const live = await opts.stripe.subscriptions.retrieve(existing.stripeSubscriptionId).catch(() => null);
    if (live && RENEWABLE_STRIPE_STATUSES.has(live.status)) {
      const portalSession = await createPortalSession({
        stripe: opts.stripe,
        stripeCustomerId: opts.stripeCustomerId,
        returnUrl: opts.returnUrl,
      });
      return { url: portalSession.url };
    }
  }

  const hasUsedTrial = existing?.stripeSubscriptionId != null;

  // Stripe rejects `trial_period_days: 0` outright ("The minimum number of
  // trial period days is 1.") - to grant NO trial the key must be omitted
  // entirely, not set to zero. Setting it to 0 previously 500'd every
  // checkout for a portal that had ever had a subscription before, which
  // made resubscribing after cancelling impossible.
  const subscriptionData = hasUsedTrial ? undefined : { trial_period_days: TRIAL_PERIOD_DAYS };

  const session = await opts.stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: opts.stripeCustomerId,
    line_items: [{ price: priceIdFor(opts.plan), quantity: 1 }],
    ...(subscriptionData ? { subscription_data: subscriptionData } : {}),
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  });
  return { url: session.url };
}

export interface CreatePortalSessionOptions {
  stripe: Stripe;
  stripeCustomerId: string;
  returnUrl: string;
}

export async function createPortalSession(opts: CreatePortalSessionOptions): Promise<Stripe.BillingPortal.Session> {
  return opts.stripe.billingPortal.sessions.create({
    customer: opts.stripeCustomerId,
    return_url: opts.returnUrl,
  });
}
