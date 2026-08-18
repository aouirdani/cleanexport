/**
 * POST /api/billing/checkout - specs/06-API-CONTRACT.md, specs/07-TASKS.md T20.
 * Creates (or reuses) the portal's Stripe Customer, then a Checkout Session
 * for the chosen plan, and returns its hosted URL - "do not build billing
 * UI, Stripe hosts Checkout." portalId always comes from the session.
 */
import { NextResponse } from 'next/server';
import { readSession } from '@/lib/session';
import { AppError, ErrorCode } from '@/lib/errors';
import { CheckoutSchema } from '@/lib/schemas';
import { stripeClient, appUrl } from '@/lib/stripe';
import { ensureStripeCustomerForPortal, createCheckoutSession } from '@/lib/billing';

export const dynamic = 'force-dynamic';

function errorResponse(err: AppError) {
  return NextResponse.json(err.toJSON(), { status: err.status });
}

export async function POST(req: Request) {
  const session = await readSession();
  if (!session) {
    return errorResponse(new AppError(ErrorCode.NOT_AUTHENTICATED, 'Not signed in', 401));
  }

  const json = await req.json().catch(() => null);
  if (json === null) {
    return errorResponse(new AppError(ErrorCode.VALIDATION_FAILED, 'Request body must be valid JSON', 400));
  }

  const parsed = CheckoutSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(
      new AppError(ErrorCode.VALIDATION_FAILED, parsed.error.issues.map((i) => i.message).join('; '), 400),
    );
  }

  const stripe = stripeClient();
  const stripeCustomerId = await ensureStripeCustomerForPortal(stripe, session.portalId, session.hubspotPortalId);

  const checkoutSession = await createCheckoutSession({
    stripe,
    stripeCustomerId,
    plan: parsed.data.plan,
    successUrl: `${appUrl()}/dashboard?checkout=success`,
    cancelUrl: `${appUrl()}/dashboard?checkout=cancelled`,
  });

  if (!checkoutSession.url) {
    return errorResponse(new AppError(ErrorCode.INTERNAL, 'Stripe did not return a Checkout URL', 502));
  }

  return NextResponse.json({ url: checkoutSession.url });
}
