import { describe, it, expect, vi, beforeEach } from 'vitest';

// lib/plan.ts - specs/06-API-CONTRACT.md "Plan gating".

const { exportDefCountMock, exportRunCountMock, subscriptionFindUniqueMock } = vi.hoisted(() => ({
  exportDefCountMock: vi.fn(),
  exportRunCountMock: vi.fn(),
  subscriptionFindUniqueMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    exportDefinition: { count: exportDefCountMock },
    exportRun: { count: exportRunCountMock },
    subscription: { findUnique: subscriptionFindUniqueMock },
  },
}));

const { assertWithinPlan, isSubscriptionLapsed, describeSubscriptionForBanner, PLAN_LIMITS, PAST_DUE_GRACE_DAYS } =
  await import('@/lib/plan');
const { AppError, ErrorCode } = await import('@/lib/errors');

beforeEach(() => {
  exportDefCountMock.mockReset();
  exportRunCountMock.mockReset();
  // Default: no Subscription row at all (a portal that never started
  // checkout) - never lapsed, so every pre-existing numeric-limit test
  // below is unaffected by subscription gating.
  subscriptionFindUniqueMock.mockReset();
  subscriptionFindUniqueMock.mockResolvedValue(null);
});

describe('assertWithinPlan - CREATE_EXPORT (limit 10) - boundary: 9 vs 10 vs 11', () => {
  it('9 existing exports: creating a 10th is allowed', async () => {
    exportDefCountMock.mockResolvedValue(9);
    await expect(assertWithinPlan('portal-1', 'CREATE_EXPORT')).resolves.toBeUndefined();
  });

  it('10 existing exports: creating an 11th is refused', async () => {
    exportDefCountMock.mockResolvedValue(10);
    await expect(assertWithinPlan('portal-1', 'CREATE_EXPORT')).rejects.toMatchObject({
      code: ErrorCode.PLAN_LIMIT_REACHED,
    });
  });

  it('a count that has somehow gone past the limit (11) is still refused, not silently allowed', async () => {
    exportDefCountMock.mockResolvedValue(11);
    await expect(assertWithinPlan('portal-1', 'CREATE_EXPORT')).rejects.toMatchObject({
      code: ErrorCode.PLAN_LIMIT_REACHED,
    });
  });

  it('scopes the count query to the calling portal only', async () => {
    exportDefCountMock.mockResolvedValue(0);
    await assertWithinPlan('portal-1', 'CREATE_EXPORT');

    expect(exportDefCountMock).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ portalId: 'portal-1' }) }));
  });

  it('the thrown error is an AppError with an actionable message', async () => {
    exportDefCountMock.mockResolvedValue(PLAN_LIMITS.MAX_EXPORT_DEFINITIONS);

    try {
      await assertWithinPlan('portal-1', 'CREATE_EXPORT');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as InstanceType<typeof AppError>).message).toContain('10');
    }
  });
});

describe('assertWithinPlan - CREATE_SCHEDULE (limit 5) - boundary: 4 vs 5', () => {
  it('4 existing scheduled exports: a 5th is allowed', async () => {
    exportDefCountMock.mockResolvedValue(4);
    await expect(assertWithinPlan('portal-1', 'CREATE_SCHEDULE')).resolves.toBeUndefined();
  });

  it('5 existing scheduled exports: a 6th is refused', async () => {
    exportDefCountMock.mockResolvedValue(5);
    await expect(assertWithinPlan('portal-1', 'CREATE_SCHEDULE')).rejects.toMatchObject({
      code: ErrorCode.PLAN_LIMIT_REACHED,
    });
  });

  it('only counts active exports that actually have a schedule', async () => {
    exportDefCountMock.mockResolvedValue(0);
    await assertWithinPlan('portal-1', 'CREATE_SCHEDULE');

    expect(exportDefCountMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ portalId: 'portal-1', isActive: true, scheduleCron: { not: null } }),
      }),
    );
  });
});

describe('assertWithinPlan - RUN_EXPORT (limit 20/day) - boundary: 19 vs 20', () => {
  it('19 runs today: a 20th is allowed', async () => {
    exportRunCountMock.mockResolvedValue(19);
    await expect(assertWithinPlan('portal-1', 'RUN_EXPORT')).resolves.toBeUndefined();
  });

  it('20 runs today: a 21st is refused', async () => {
    exportRunCountMock.mockResolvedValue(20);
    await expect(assertWithinPlan('portal-1', 'RUN_EXPORT')).rejects.toMatchObject({
      code: ErrorCode.PLAN_LIMIT_REACHED,
    });
  });

  it('counts only today\'s runs for this portal, not the export\'s all-time total', async () => {
    exportRunCountMock.mockResolvedValue(0);
    await assertWithinPlan('portal-1', 'RUN_EXPORT');

    const call = exportRunCountMock.mock.calls[0][0] as { where: { portalId: string; createdAt: { gte: Date } } };
    expect(call.where.portalId).toBe('portal-1');
    expect(call.where.createdAt.gte.getUTCHours()).toBe(0);
    expect(call.where.createdAt.gte.getUTCMinutes()).toBe(0);
  });

  it('the refusal names the limit (20/day) and a concrete UTC reset time, not a generic error', async () => {
    exportRunCountMock.mockResolvedValue(20);

    try {
      await assertWithinPlan('portal-1', 'RUN_EXPORT');
      expect.unreachable();
    } catch (err) {
      const message = (err as InstanceType<typeof AppError>).message;
      expect(message).toContain('20'); // the limit itself
      expect(message).toMatch(/resets at .+UTC/); // a concrete, parseable reset time
    }
  });
});

describe('assertWithinPlan - CHECK_ROW_COUNT (limit 250,000) - boundary: at vs over', () => {
  it('exactly at the limit is allowed (the limit is inclusive)', async () => {
    await expect(
      assertWithinPlan('portal-1', 'CHECK_ROW_COUNT', { rowCount: PLAN_LIMITS.MAX_ROWS_PER_EXPORT }),
    ).resolves.toBeUndefined();
  });

  it('one row over the limit is refused', async () => {
    await expect(
      assertWithinPlan('portal-1', 'CHECK_ROW_COUNT', { rowCount: PLAN_LIMITS.MAX_ROWS_PER_EXPORT + 1 }),
    ).rejects.toMatchObject({ code: ErrorCode.PLAN_LIMIT_REACHED });
  });

  it('no context defaults rowCount to 0 - never throws for a missing count', async () => {
    await expect(assertWithinPlan('portal-1', 'CHECK_ROW_COUNT')).resolves.toBeUndefined();
  });

  it('does not touch the database at all - it only judges the given count', async () => {
    await assertWithinPlan('portal-1', 'CHECK_ROW_COUNT', { rowCount: 100 });
    expect(exportDefCountMock).not.toHaveBeenCalled();
    expect(exportRunCountMock).not.toHaveBeenCalled();
  });

  it('is exempt from subscription gating too - it judges a run already in flight, not whether one may start', async () => {
    subscriptionFindUniqueMock.mockResolvedValue({ status: 'CANCELED', trialEndsAt: null, pastDueSince: null });
    await expect(assertWithinPlan('portal-1', 'CHECK_ROW_COUNT', { rowCount: 100 })).resolves.toBeUndefined();
    expect(subscriptionFindUniqueMock).not.toHaveBeenCalled();
  });
});

// Requirement 1: "assertWithinPlan must consider Subscription.status. A
// portal whose status is CANCELED, or TRIALING with trialEndsAt in the
// past, cannot create exports or run them." Covers each status at its
// boundary, including PAST_DUE's grace period (requirement 5) and a trial
// that expires exactly between two runs.
describe('assertWithinPlan - subscription gating (CREATE_EXPORT, CREATE_SCHEDULE, RUN_EXPORT)', () => {
  beforeEach(() => {
    exportDefCountMock.mockResolvedValue(0);
    exportRunCountMock.mockResolvedValue(0);
  });

  const GATED_ACTIONS = ['CREATE_EXPORT', 'CREATE_SCHEDULE', 'RUN_EXPORT'] as const;

  it.each(GATED_ACTIONS)('%s: no Subscription row at all (never checked out) is allowed', async (action) => {
    subscriptionFindUniqueMock.mockResolvedValue(null);
    await expect(assertWithinPlan('portal-1', action)).resolves.toBeUndefined();
  });

  it.each(GATED_ACTIONS)('%s: ACTIVE is always allowed', async (action) => {
    subscriptionFindUniqueMock.mockResolvedValue({ status: 'ACTIVE', trialEndsAt: null, pastDueSince: null });
    await expect(assertWithinPlan('portal-1', action)).resolves.toBeUndefined();
  });

  it.each(GATED_ACTIONS)('%s: CANCELED is always refused', async (action) => {
    subscriptionFindUniqueMock.mockResolvedValue({ status: 'CANCELED', trialEndsAt: null, pastDueSince: null });
    await expect(assertWithinPlan('portal-1', action)).rejects.toMatchObject({
      code: ErrorCode.SUBSCRIPTION_INACTIVE,
    });
  });

  describe('TRIALING - boundary at trialEndsAt', () => {
    it.each(GATED_ACTIONS)('%s: trialEndsAt one second in the future is allowed', async (action) => {
      subscriptionFindUniqueMock.mockResolvedValue({
        status: 'TRIALING',
        trialEndsAt: new Date(Date.now() + 1000),
        pastDueSince: null,
      });
      await expect(assertWithinPlan('portal-1', action)).resolves.toBeUndefined();
    });

    it.each(GATED_ACTIONS)('%s: trialEndsAt exactly now is refused (inclusive boundary)', async (action) => {
      const now = new Date();
      vi.useFakeTimers();
      vi.setSystemTime(now);
      subscriptionFindUniqueMock.mockResolvedValue({ status: 'TRIALING', trialEndsAt: now, pastDueSince: null });
      await expect(assertWithinPlan('portal-1', action)).rejects.toMatchObject({
        code: ErrorCode.SUBSCRIPTION_INACTIVE,
      });
      vi.useRealTimers();
    });

    it.each(GATED_ACTIONS)('%s: trialEndsAt one second in the past is refused', async (action) => {
      subscriptionFindUniqueMock.mockResolvedValue({
        status: 'TRIALING',
        trialEndsAt: new Date(Date.now() - 1000),
        pastDueSince: null,
      });
      await expect(assertWithinPlan('portal-1', action)).rejects.toMatchObject({
        code: ErrorCode.SUBSCRIPTION_INACTIVE,
      });
    });

    it.each(GATED_ACTIONS)('%s: TRIALING with no trialEndsAt yet (not synced from Stripe) is allowed', async (action) => {
      subscriptionFindUniqueMock.mockResolvedValue({ status: 'TRIALING', trialEndsAt: null, pastDueSince: null });
      await expect(assertWithinPlan('portal-1', action)).resolves.toBeUndefined();
    });

    it('a trial that expires BETWEEN two runs: the first is allowed, the second (after expiry) is refused', async () => {
      const trialEndsAt = new Date(Date.now() + 5000);
      subscriptionFindUniqueMock.mockResolvedValue({ status: 'TRIALING', trialEndsAt, pastDueSince: null });

      vi.useFakeTimers();
      vi.setSystemTime(new Date(trialEndsAt.getTime() - 1000)); // just before expiry
      await expect(assertWithinPlan('portal-1', 'RUN_EXPORT')).resolves.toBeUndefined();

      vi.setSystemTime(new Date(trialEndsAt.getTime() + 1000)); // just after expiry
      await expect(assertWithinPlan('portal-1', 'RUN_EXPORT')).rejects.toMatchObject({
        code: ErrorCode.SUBSCRIPTION_INACTIVE,
      });
      vi.useRealTimers();
    });
  });

  describe('PAST_DUE - grace period boundary', () => {
    it.each(GATED_ACTIONS)('%s: just inside the grace period is allowed', async (action) => {
      subscriptionFindUniqueMock.mockResolvedValue({
        status: 'PAST_DUE',
        trialEndsAt: null,
        pastDueSince: new Date(Date.now() - (PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000 - 1000)),
      });
      await expect(assertWithinPlan('portal-1', action)).resolves.toBeUndefined();
    });

    it.each(GATED_ACTIONS)('%s: exactly at the grace period boundary is refused (inclusive)', async (action) => {
      const pastDueSince = new Date(Date.now() - PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000);
      vi.useFakeTimers();
      vi.setSystemTime(new Date(pastDueSince.getTime() + PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000));
      subscriptionFindUniqueMock.mockResolvedValue({ status: 'PAST_DUE', trialEndsAt: null, pastDueSince });
      await expect(assertWithinPlan('portal-1', action)).rejects.toMatchObject({
        code: ErrorCode.SUBSCRIPTION_INACTIVE,
      });
      vi.useRealTimers();
    });

    it.each(GATED_ACTIONS)('%s: just past the grace period is refused', async (action) => {
      subscriptionFindUniqueMock.mockResolvedValue({
        status: 'PAST_DUE',
        trialEndsAt: null,
        pastDueSince: new Date(Date.now() - (PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000 + 1000)),
      });
      await expect(assertWithinPlan('portal-1', action)).rejects.toMatchObject({
        code: ErrorCode.SUBSCRIPTION_INACTIVE,
      });
    });
  });

  it('the refusal is scoped to the calling portal only', async () => {
    subscriptionFindUniqueMock.mockResolvedValue({ status: 'CANCELED', trialEndsAt: null, pastDueSince: null });
    await assertWithinPlan('portal-1', 'RUN_EXPORT').catch(() => {});
    expect(subscriptionFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { portalId: 'portal-1' } }),
    );
  });

  it('a lapsed subscription is refused before the numeric limit is even checked', async () => {
    subscriptionFindUniqueMock.mockResolvedValue({ status: 'CANCELED', trialEndsAt: null, pastDueSince: null });
    await assertWithinPlan('portal-1', 'CREATE_EXPORT').catch(() => {});
    expect(exportDefCountMock).not.toHaveBeenCalled();
  });
});

describe('isSubscriptionLapsed - pure boundary logic, reused by the dashboard to explain itself', () => {
  it('null subscription is never lapsed', () => {
    expect(isSubscriptionLapsed(null)).toBe(false);
  });

  it('ACTIVE is never lapsed', () => {
    expect(isSubscriptionLapsed({ status: 'ACTIVE' as never, trialEndsAt: null, pastDueSince: null })).toBe(false);
  });

  it('CANCELED is always lapsed', () => {
    expect(isSubscriptionLapsed({ status: 'CANCELED' as never, trialEndsAt: null, pastDueSince: null })).toBe(true);
  });
});

// Requirement 4: "The dashboard states the situation plainly: how many days
// remain, or that the trial ended and what it blocks, with the checkout
// CTA." describeSubscriptionForBanner is the one place that turns a row
// into that verdict, so components/dashboard/billing-banner.tsx never
// recomputes lapsed-ness differently than assertWithinPlan does.
describe('describeSubscriptionForBanner', () => {
  it('null subscription passes through as null (never checked out)', () => {
    expect(describeSubscriptionForBanner(null)).toBeNull();
  });

  it('TRIALING with days left: trialDaysRemaining is set, isLapsed is false, graceDaysRemaining is null', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const trialEndsAt = new Date('2026-01-04T00:00:00Z');
    const result = describeSubscriptionForBanner(
      { status: 'TRIALING' as never, trialEndsAt, cancelAtPeriodEnd: false, pastDueSince: null },
      now,
    );
    expect(result).toMatchObject({ isLapsed: false, trialDaysRemaining: 3, graceDaysRemaining: null, trialEndsAt });
  });

  it('trialEndsAt is null for every non-TRIALING status, even when the row itself carries a stale value', () => {
    const result = describeSubscriptionForBanner({
      status: 'ACTIVE' as never,
      trialEndsAt: new Date('2026-01-04T00:00:00Z'),
      cancelAtPeriodEnd: false,
      pastDueSince: null,
    });
    expect(result!.trialEndsAt).toBeNull();
  });

  it('TRIALING past its end: isLapsed is true and trialDaysRemaining is <= 0, not hidden or clamped away', () => {
    const now = new Date('2026-01-05T00:00:00Z');
    const trialEndsAt = new Date('2026-01-04T00:00:00Z');
    const result = describeSubscriptionForBanner(
      { status: 'TRIALING' as never, trialEndsAt, cancelAtPeriodEnd: false, pastDueSince: null },
      now,
    );
    expect(result).toMatchObject({ isLapsed: true });
    expect(result!.trialDaysRemaining).toBeLessThanOrEqual(0);
  });

  it('PAST_DUE within grace: graceDaysRemaining is set, isLapsed is false, trialDaysRemaining is null', () => {
    const now = new Date('2026-01-03T00:00:00Z');
    const pastDueSince = new Date('2026-01-01T00:00:00Z'); // 2 days ago, grace is 7
    const result = describeSubscriptionForBanner(
      { status: 'PAST_DUE' as never, trialEndsAt: null, cancelAtPeriodEnd: false, pastDueSince },
      now,
    );
    expect(result).toMatchObject({ isLapsed: false, graceDaysRemaining: 5, trialDaysRemaining: null });
  });

  it('PAST_DUE beyond grace: isLapsed is true', () => {
    const now = new Date('2026-01-10T00:00:00Z');
    const pastDueSince = new Date('2026-01-01T00:00:00Z'); // 9 days ago, grace is 7
    const result = describeSubscriptionForBanner(
      { status: 'PAST_DUE' as never, trialEndsAt: null, cancelAtPeriodEnd: false, pastDueSince },
      now,
    );
    expect(result).toMatchObject({ isLapsed: true });
  });

  it('CANCELED: isLapsed is true, both day counts are null', () => {
    const result = describeSubscriptionForBanner({
      status: 'CANCELED' as never,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      pastDueSince: null,
    });
    expect(result).toMatchObject({ isLapsed: true, trialDaysRemaining: null, graceDaysRemaining: null });
  });

  it('ACTIVE: isLapsed is false, both day counts are null', () => {
    const result = describeSubscriptionForBanner({
      status: 'ACTIVE' as never,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
      pastDueSince: null,
    });
    expect(result).toMatchObject({ isLapsed: false, trialDaysRemaining: null, graceDaysRemaining: null });
  });
});
