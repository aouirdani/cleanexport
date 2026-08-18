/**
 * POST /api/webhooks/stripe - specs/06-API-CONTRACT.md, specs/07-TASKS.md T20.
 *
 * THE SECURITY REQUIREMENT: verify the Stripe signature BEFORE parsing
 * anything. An unverified webhook route lets anyone POST themselves a paid
 * subscription. This is why the body is read with `req.text()`, never
 * `req.json()` - `stripe.webhooks.constructEvent` needs the EXACT raw bytes
 * Stripe signed; any parsing (even JSON.parse followed by JSON.stringify)
 * can change whitespace/key order and break the signature check. The raw
 * text is read once, passed untouched into constructEvent, and only turned
 * into a typed `event.data.object` AFTER that call has succeeded.
 *
 * A signature failure returns 400 and does nothing else: no database
 * access, no logging of the payload (which is untrusted at that point -
 * could be anything). Nothing is parsed, nothing is written.
 *
 * Idempotency: see lib/billing.ts's file header - the handlers below are
 * idempotent by construction (they SET absolute state from the event, never
 * increment), so no separate "already processed this event id" table is
 * needed to satisfy "receiving the same event twice must not create two
 * subscriptions or double an expiry."
 */
import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripeClient, stripeWebhookSecret } from '@/lib/stripe';
import {
  handleCheckoutSessionCompleted,
  handleSubscriptionDeleted,
  handleInvoicePaymentFailed,
  syncSubscriptionFromStripeObject,
} from '@/lib/billing';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const signature = req.headers.get('stripe-signature');
  const rawBody = await req.text(); // raw bytes, never req.json() - see file header

  if (!signature) {
    return NextResponse.json({ error: { message: 'Missing stripe-signature header' } }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(rawBody, signature, stripeWebhookSecret());
  } catch {
    // Never echo back why - a bad signature gets a flat 400, no detail that
    // would help an attacker iterate toward a valid one.
    return NextResponse.json({ error: { message: 'Invalid signature' } }, { status: 400 });
  }

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(stripeClient(), event.data.object as Stripe.Checkout.Session);
      break;
    case 'customer.subscription.updated':
      await syncSubscriptionFromStripeObject(event.data.object as Stripe.Subscription);
      break;
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      break;
    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
      break;
    default:
      // Any other event type Stripe sends to this endpoint is acknowledged
      // and ignored, not an error - only the four listed events are handled.
      break;
  }

  return NextResponse.json({ received: true });
}
