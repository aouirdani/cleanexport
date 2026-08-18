import { describe, it, expect, vi, beforeEach } from 'vitest';

// lib/plan.ts - specs/06-API-CONTRACT.md "Plan gating".

const { exportDefCountMock, exportRunCountMock } = vi.hoisted(() => ({
  exportDefCountMock: vi.fn(),
  exportRunCountMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    exportDefinition: { count: exportDefCountMock },
    exportRun: { count: exportRunCountMock },
  },
}));

const { assertWithinPlan, PLAN_LIMITS } = await import('@/lib/plan');
const { AppError, ErrorCode } = await import('@/lib/errors');

beforeEach(() => {
  exportDefCountMock.mockReset();
  exportRunCountMock.mockReset();
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
});
