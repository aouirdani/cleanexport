/**
 * Resolves the signed-in portal/user from the session cookie - the same
 * data GET /api/auth/session returns (specs/06-API-CONTRACT.md), shared by
 * that route and every server component under app/(app) so dashboard pages
 * read identical portal/session data without a server component fetching
 * its own API over HTTP.
 *
 * Wrapped in React's cache(): app/(app)/layout.tsx and each page under it
 * (e.g. app/(app)/dashboard/page.tsx) call this independently, and cache()
 * dedupes those calls to one DB round trip per request rather than one per
 * component.
 */
import { cache } from 'react';
import { prisma } from '@/lib/db';
import { readSession } from '@/lib/session';
import type { SubStatus } from '@/lib/generated/prisma/client';

export interface CurrentPortal {
  id: string;
  /** HubSpot's own portal id, as a string - see lib/session.ts's SessionData for why. */
  hubspotPortalId: string;
  name: string | null;
  hubDomain: string | null;
  disconnectedAt: Date | null;
}

export interface CurrentUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

/** Just what the trial-countdown/billing banner needs (components/dashboard/billing-banner.tsx) - specs/07-TASKS.md T20. */
export interface CurrentSubscription {
  status: SubStatus;
  trialEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
  /** Needed to compute the PAST_DUE grace period - see lib/plan.ts's isSubscriptionLapsed. */
  pastDueSince: Date | null;
}

export type CurrentSessionResult =
  | { ok: true; portal: CurrentPortal; user: CurrentUser | null; subscription: CurrentSubscription | null }
  | { ok: false; reason: 'NOT_AUTHENTICATED' | 'SESSION_INVALID' };

export const getCurrentSession = cache(async (): Promise<CurrentSessionResult> => {
  const session = await readSession();
  if (!session) return { ok: false, reason: 'NOT_AUTHENTICATED' };

  const portal = await prisma.portal.findUnique({
    where: { id: session.portalId },
    select: { id: true, hubspotPortalId: true, name: true, hubDomain: true, disconnectedAt: true },
  });
  // The portal row backing an otherwise-valid session cookie is gone (e.g. deleted
  // directly in the DB) - distinct from "never logged in", so the API route can
  // still tell the two apart (SESSION_INVALID vs NOT_AUTHENTICATED).
  if (!portal) return { ok: false, reason: 'SESSION_INVALID' };

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, firstName: true, lastName: true },
  });

  const subscription = await prisma.subscription.findUnique({
    where: { portalId: session.portalId },
    select: { status: true, trialEndsAt: true, cancelAtPeriodEnd: true, pastDueSince: true },
  });

  return {
    ok: true,
    portal: { ...portal, hubspotPortalId: portal.hubspotPortalId.toString() },
    user,
    subscription,
  };
});
