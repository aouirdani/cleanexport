/**
 * specs/06-API-CONTRACT.md "Plan gating": "Enforce in a single
 * assertWithinPlan(portalId, action) helper, called by the handlers that
 * need it. Not scattered if statements."
 *
 * Trial and Solo share one row in the limits table (specs/06-API-CONTRACT.md's
 * table has a single "Trial / Solo" column) - specs/07-TASKS.md T20 adds
 * billing (Checkout, the Customer Portal, webhook-driven Subscription sync),
 * but it does not introduce a second, more generous tier. Every portal is
 * held to the same NUMERIC limits regardless of Subscription.status - what
 * status DOES gate is whether the portal may act at all (below).
 *
 * RUN_EXPORT is called from app/api/exports/[id]/run/route.ts (the manual
 * "Run now" trigger), the same way CREATE_EXPORT/CREATE_SCHEDULE are called
 * from app/api/exports/route.ts. CHECK_ROW_COUNT is complete and tested
 * here but still has no live caller: enforcing it means knowing a run's
 * actual row count mid-fetch, which only inngest/exportRun.ts's pipeline
 * can observe, and that file is out of scope for the tasks that have
 * touched this one so far.
 *
 * Subscription gating: a lapsed subscription blocks CREATE_EXPORT,
 * CREATE_SCHEDULE, and RUN_EXPORT (nothing NEW happens), but never touches
 * existing data - past exports, run history, and downloadable files all
 * stay visible. "Lapsed" means:
 *   - CANCELED, always.
 *   - TRIALING with trialEndsAt in the past (a trial with no trialEndsAt
 *     yet, or no Subscription row at all - a portal that never started
 *     checkout - has no known end and is never blocked on this basis).
 *   - PAST_DUE, but only after PAST_DUE_GRACE_DAYS since it became
 *     PAST_DUE (Subscription.pastDueSince): Stripe's own retry schedule
 *     runs for days, and cutting off a paying customer over one declined
 *     card is worse than letting a few extra runs through.
 *   - ACTIVE is never blocked.
 * CHECK_ROW_COUNT is exempt: it judges a run already in flight, not
 * whether one may start.
 */
import { prisma } from '@/lib/db';
import { AppError, ErrorCode } from '@/lib/errors';
import { SubStatus } from '@/lib/generated/prisma/client';

export const PLAN_LIMITS = {
  MAX_EXPORT_DEFINITIONS: 10,
  MAX_SCHEDULED_EXPORTS: 5,
  MAX_RUNS_PER_DAY: 20,
  MAX_ROWS_PER_EXPORT: 250_000,
} as const;

/** Days a PAST_DUE subscription still gets to run/create exports before it's treated as lapsed. */
export const PAST_DUE_GRACE_DAYS = 7;

export type PlanAction = 'CREATE_EXPORT' | 'CREATE_SCHEDULE' | 'RUN_EXPORT' | 'CHECK_ROW_COUNT';

const ACTIONS_REQUIRING_ACTIVE_SUBSCRIPTION: ReadonlySet<PlanAction> = new Set([
  'CREATE_EXPORT',
  'CREATE_SCHEDULE',
  'RUN_EXPORT',
]);

export interface SubscriptionLike {
  status: SubStatus;
  trialEndsAt: Date | null;
  pastDueSince: Date | null;
}

/** Exported for reuse by the dashboard (which needs the same verdict to explain itself, not just enforce it). */
export function isSubscriptionLapsed(subscription: SubscriptionLike | null, now: Date = new Date()): boolean {
  if (!subscription) return false; // never started checkout - nothing to have lapsed
  switch (subscription.status) {
    case SubStatus.CANCELED:
      return true;
    case SubStatus.TRIALING:
      return subscription.trialEndsAt !== null && subscription.trialEndsAt <= now;
    case SubStatus.PAST_DUE: {
      if (!subscription.pastDueSince) return false; // shouldn't happen in practice, but never block without a basis
      const graceEnds = subscription.pastDueSince.getTime() + PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;
      return now.getTime() >= graceEnds;
    }
    case SubStatus.ACTIVE:
      return false;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SubscriptionBannerState {
  status: SubStatus;
  cancelAtPeriodEnd: boolean;
  /** Same verdict assertWithinPlan enforces - requirement 4 is explaining it, not recomputing it differently. */
  isLapsed: boolean;
  /** Only meaningful for TRIALING with a known trialEndsAt; can be <= 0 once lapsed. */
  trialDaysRemaining: number | null;
  /**
   * The raw date, passed through as-is (not formatted here): the banner
   * states "the date the trial ends," not just a day count, and formatting
   * a given Date is safe inside the 'use client' banner (no Date.now() read
   * there - see components/dashboard/billing-banner.tsx's own header
   * comment on why that distinction matters). Only meaningful alongside
   * trialDaysRemaining.
   */
  trialEndsAt: Date | null;
  /** Only meaningful for PAST_DUE with a known pastDueSince; can be <= 0 once the grace period has elapsed. */
  graceDaysRemaining: number | null;
}

/**
 * The single place that turns a Subscription row into what the dashboard
 * banner (components/dashboard/billing-banner.tsx) says - "how many days
 * remain, or that the trial ended and what it blocks" (requirement 4).
 * `now` is a parameter (not read internally) so this stays pure and testable
 * without faking the system clock.
 */
export function describeSubscriptionForBanner(
  subscription: (SubscriptionLike & { cancelAtPeriodEnd: boolean }) | null,
  now: Date = new Date(),
): SubscriptionBannerState | null {
  if (!subscription) return null;

  return {
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    isLapsed: isSubscriptionLapsed(subscription, now),
    trialDaysRemaining:
      subscription.status === SubStatus.TRIALING && subscription.trialEndsAt
        ? Math.ceil((subscription.trialEndsAt.getTime() - now.getTime()) / DAY_MS)
        : null,
    trialEndsAt: subscription.status === SubStatus.TRIALING ? subscription.trialEndsAt : null,
    graceDaysRemaining:
      subscription.status === SubStatus.PAST_DUE && subscription.pastDueSince
        ? Math.ceil((subscription.pastDueSince.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS - now.getTime()) / DAY_MS)
        : null,
  };
}

export interface PlanActionContext {
  /** Required for CHECK_ROW_COUNT - the row count a run actually matched (or is about to fetch). */
  rowCount?: number;
}

function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const RESET_TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** specs/07-TASKS.md: "say which limit and when it resets - not a generic error." */
function runsPerDayResetLabel(now: Date): string {
  const resetAt = new Date(startOfUtcDay(now).getTime() + 24 * 60 * 60 * 1000);
  return `${RESET_TIME_FORMAT.format(resetAt)} UTC`;
}

export async function assertWithinPlan(
  portalId: string,
  action: PlanAction,
  context: PlanActionContext = {},
): Promise<void> {
  if (ACTIONS_REQUIRING_ACTIVE_SUBSCRIPTION.has(action)) {
    const subscription = await prisma.subscription.findUnique({
      where: { portalId },
      select: { status: true, trialEndsAt: true, pastDueSince: true },
    });
    if (isSubscriptionLapsed(subscription)) {
      throw new AppError(
        ErrorCode.SUBSCRIPTION_INACTIVE,
        subscription?.status === SubStatus.CANCELED
          ? 'Your subscription was canceled. Subscribe to create or run exports again.'
          : subscription?.status === SubStatus.PAST_DUE
            ? 'Your payment is past due. Update your payment method to create or run exports again.'
            : 'Your trial has ended. Subscribe to create or run exports again.',
        403,
      );
    }
  }

  switch (action) {
    case 'CREATE_EXPORT': {
      const count = await prisma.exportDefinition.count({ where: { portalId, isActive: true } });
      if (count >= PLAN_LIMITS.MAX_EXPORT_DEFINITIONS) {
        throw new AppError(
          ErrorCode.PLAN_LIMIT_REACHED,
          `Your plan allows up to ${PLAN_LIMITS.MAX_EXPORT_DEFINITIONS} export definitions. Delete one before creating another.`,
          403,
        );
      }
      return;
    }
    case 'CREATE_SCHEDULE': {
      const count = await prisma.exportDefinition.count({
        where: { portalId, isActive: true, scheduleCron: { not: null } },
      });
      if (count >= PLAN_LIMITS.MAX_SCHEDULED_EXPORTS) {
        throw new AppError(
          ErrorCode.PLAN_LIMIT_REACHED,
          `Your plan allows up to ${PLAN_LIMITS.MAX_SCHEDULED_EXPORTS} scheduled exports. Remove a schedule from another export first.`,
          403,
        );
      }
      return;
    }
    case 'RUN_EXPORT': {
      const now = new Date();
      const count = await prisma.exportRun.count({
        where: { portalId, createdAt: { gte: startOfUtcDay(now) } },
      });
      if (count >= PLAN_LIMITS.MAX_RUNS_PER_DAY) {
        throw new AppError(
          ErrorCode.PLAN_LIMIT_REACHED,
          `You've used all ${PLAN_LIMITS.MAX_RUNS_PER_DAY} of today's export runs. This limit resets at ${runsPerDayResetLabel(now)}.`,
          403,
        );
      }
      return;
    }
    case 'CHECK_ROW_COUNT': {
      const rowCount = context.rowCount ?? 0;
      if (rowCount > PLAN_LIMITS.MAX_ROWS_PER_EXPORT) {
        throw new AppError(
          ErrorCode.PLAN_LIMIT_REACHED,
          `This export matched ${rowCount.toLocaleString()} rows, over your plan's ${PLAN_LIMITS.MAX_ROWS_PER_EXPORT.toLocaleString()}-row limit per export. Add a filter to narrow it.`,
          403,
        );
      }
      return;
    }
  }
}
