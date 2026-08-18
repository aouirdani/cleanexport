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

  // current_period_end moved from the Subscription object onto its items in
  // recent Stripe API versions - see node_modules/stripe's SubscriptionItems type.
  const currentPeriodEnd = subscription.items.data[0]?.current_period_end;

  await prisma.subscription.update({
    where: { portalId },
    data: {
      stripeSubscriptionId: subscription.id,
      status: mapStripeStatus(subscription.status),
      trialEndsAt: unixToDate(subscription.trial_end),
      currentPeriodEnd: unixToDate(currentPeriodEnd),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
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
    data: { status: SubStatus.CANCELED, stripeSubscriptionId: subscription.id, cancelAtPeriodEnd: false },
  });
}

export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const stripeCustomerId = customerId(invoice.customer);
  if (!stripeCustomerId) return;

  const portalId = await resolvePortalIdByCustomerId(stripeCustomerId);
  if (!portalId) return;

  await prisma.subscription.update({
    where: { portalId },
    data: { status: SubStatus.PAST_DUE },
  });
}

export interface CreateCheckoutSessionOptions {
  stripe: Stripe;
  stripeCustomerId: string;
  plan: BillingPlan;
  successUrl: string;
  cancelUrl: string;
}

export async function createCheckoutSession(opts: CreateCheckoutSessionOptions): Promise<Stripe.Checkout.Session> {
  return opts.stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: opts.stripeCustomerId,
    line_items: [{ price: priceIdFor(opts.plan), quantity: 1 }],
    subscription_data: { trial_period_days: TRIAL_PERIOD_DAYS },
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  });
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
