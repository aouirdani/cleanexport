import { describe, it, expect, vi, beforeEach } from 'vitest';

// lib/plan.ts - specs/06-API-CONTRACT.md "Plan gating".

const { countMock } = vi.hoisted(() => ({ countMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { exportDefinition: { count: countMock } } }));

const { assertWithinPlan, PLAN_LIMITS } = await import('@/lib/plan');
const { AppError, ErrorCode } = await import('@/lib/errors');

beforeEach(() => {
  countMock.mockReset();
});

describe('assertWithinPlan - CREATE_EXPORT', () => {
  it('allows creation below the limit', async () => {
    countMock.mockResolvedValue(PLAN_LIMITS.MAX_EXPORT_DEFINITIONS - 1);
    await expect(assertWithinPlan('portal-1', 'CREATE_EXPORT')).resolves.toBeUndefined();
  });

  it('refuses at the limit with PLAN_LIMIT_REACHED', async () => {
    countMock.mockResolvedValue(PLAN_LIMITS.MAX_EXPORT_DEFINITIONS);

    await expect(assertWithinPlan('portal-1', 'CREATE_EXPORT')).rejects.toMatchObject({
      code: ErrorCode.PLAN_LIMIT_REACHED,
    });
  });

  it('scopes the count query to the calling portal only', async () => {
    countMock.mockResolvedValue(0);
    await assertWithinPlan('portal-1', 'CREATE_EXPORT');

    expect(countMock).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ portalId: 'portal-1' }) }));
  });

  it('the thrown error is an AppError with an actionable message', async () => {
    countMock.mockResolvedValue(PLAN_LIMITS.MAX_EXPORT_DEFINITIONS);

    try {
      await assertWithinPlan('portal-1', 'CREATE_EXPORT');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as InstanceType<typeof AppError>).message).toContain('10');
    }
  });
});

describe('assertWithinPlan - CREATE_SCHEDULE', () => {
  it('allows scheduling below the limit', async () => {
    countMock.mockResolvedValue(PLAN_LIMITS.MAX_SCHEDULED_EXPORTS - 1);
    await expect(assertWithinPlan('portal-1', 'CREATE_SCHEDULE')).resolves.toBeUndefined();
  });

  it('refuses at the limit', async () => {
    countMock.mockResolvedValue(PLAN_LIMITS.MAX_SCHEDULED_EXPORTS);

    await expect(assertWithinPlan('portal-1', 'CREATE_SCHEDULE')).rejects.toMatchObject({
      code: ErrorCode.PLAN_LIMIT_REACHED,
    });
  });

  it('only counts active exports that actually have a schedule', async () => {
    countMock.mockResolvedValue(0);
    await assertWithinPlan('portal-1', 'CREATE_SCHEDULE');

    expect(countMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ portalId: 'portal-1', isActive: true, scheduleCron: { not: null } }),
      }),
    );
  });
});
