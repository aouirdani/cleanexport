/**
 * POST /api/billing/portal - specs/06-API-CONTRACT.md, specs/07-TASKS.md T20.
 * Returns a Stripe Customer Portal URL for the caller's own portal -
 * "do not build billing UI, Stripe hosts... the Portal." portalId always
 * comes from the session, and the Stripe customer id is looked up from our
 * own Subscription row for it - never accepted as input.
 */
import { NextResponse } from 'next/server';
import { readSession } from '@/lib/session';
import { AppError, ErrorCode } from '@/lib/errors';
import { stripeClient, appUrl } from '@/lib/stripe';
import { getSubscriptionForPortal, createPortalSession } from '@/lib/billing';

export const dynamic = 'force-dynamic';

function errorResponse(err: AppError) {
  return NextResponse.json(err.toJSON(), { status: err.status });
}

export async function POST() {
  const session = await readSession();
  if (!session) {
    return errorResponse(new AppError(ErrorCode.NOT_AUTHENTICATED, 'Not signed in', 401));
  }

  const subscription = await getSubscriptionForPortal(session.portalId);
  if (!subscription) {
    return errorResponse(
      new AppError(ErrorCode.NOT_FOUND, 'Start a subscription before opening the billing portal', 404),
    );
  }

  const portalSession = await createPortalSession({
    stripe: stripeClient(),
    stripeCustomerId: subscription.stripeCustomerId,
    returnUrl: `${appUrl()}/dashboard`,
  });

  return NextResponse.json({ url: portalSession.url });
}
