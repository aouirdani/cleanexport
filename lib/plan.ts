/**
 * specs/06-API-CONTRACT.md "Plan gating": "Enforce in a single
 * assertWithinPlan(portalId, action) helper, called by the handlers that
 * need it. Not scattered if statements."
 *
 * Trial/Solo is the only plan the MVP has - Stripe/plan selection is
 * specs/07-TASKS.md T20, not built yet - so every portal is held to the
 * same limits table until billing exists.
 */
import { prisma } from '@/lib/db';
import { AppError, ErrorCode } from '@/lib/errors';

export const PLAN_LIMITS = {
  MAX_EXPORT_DEFINITIONS: 10,
  MAX_SCHEDULED_EXPORTS: 5,
} as const;

export type PlanAction = 'CREATE_EXPORT' | 'CREATE_SCHEDULE';

export async function assertWithinPlan(portalId: string, action: PlanAction): Promise<void> {
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
  }
}
