/**
 * specs/06-API-CONTRACT.md "Plan gating": "Enforce in a single
 * assertWithinPlan(portalId, action) helper, called by the handlers that
 * need it. Not scattered if statements."
 *
 * Trial and Solo share one row in the limits table (specs/06-API-CONTRACT.md's
 * table has a single "Trial / Solo" column) - specs/07-TASKS.md T20 adds
 * billing (Checkout, the Customer Portal, webhook-driven Subscription sync),
 * but it does not introduce a second, more generous tier. Every portal is
 * held to the same limits regardless of Subscription.status.
 *
 * RUN_EXPORT is called from app/api/exports/[id]/run/route.ts (the manual
 * "Run now" trigger), the same way CREATE_EXPORT/CREATE_SCHEDULE are called
 * from app/api/exports/route.ts. CHECK_ROW_COUNT is complete and tested
 * here but still has no live caller: enforcing it means knowing a run's
 * actual row count mid-fetch, which only inngest/exportRun.ts's pipeline
 * can observe, and that file is out of scope for the tasks that have
 * touched this one so far.
 */
import { prisma } from '@/lib/db';
import { AppError, ErrorCode } from '@/lib/errors';

export const PLAN_LIMITS = {
  MAX_EXPORT_DEFINITIONS: 10,
  MAX_SCHEDULED_EXPORTS: 5,
  MAX_RUNS_PER_DAY: 20,
  MAX_ROWS_PER_EXPORT: 250_000,
} as const;

export type PlanAction = 'CREATE_EXPORT' | 'CREATE_SCHEDULE' | 'RUN_EXPORT' | 'CHECK_ROW_COUNT';

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
