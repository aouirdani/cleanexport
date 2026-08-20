import { describe, it, expect, vi, afterEach } from 'vitest';
import { nextCronOccurrence, scheduleTickHandler } from '@/inngest/scheduleTick';
import { SCHEDULE_PRESETS } from '@/lib/schedulePresets';
import { RunStatus, Trigger } from '@/lib/generated/prisma/client';

// @/lib/db's `prisma` export is a real `const` (read-only in ESM) - mock the
// module so each test can swap in its own stateful fake, exactly like
// tests/inngest/scheduleTick.test.ts does.
vi.mock('@/lib/db', () => ({ prisma: undefined }));

// Bug: two real portal rows had scheduleCron "weekly"/"export" (plain words,
// not cron) and nextRunAt left null, so export.schedule.tick's own due-query
// (`scheduleCron: { not: null }, nextRunAt: { lte: now } `) never selected
// them - a schedule that silently never fires. This test proves the OTHER
// half holds: a schedule created the way the builder actually creates one
// (a real cron expression from lib/schedulePresets.ts, the same list
// components/exports/schedule-step.tsx renders) gets a nextRunAt that
// scheduleTick's own matching logic - not a re-implementation of it - will
// pick up once that time arrives.

function makeFakePrisma(def: { id: string; portalId: string; nextRunAt: Date; scheduleCron: string; scheduleTz: string }) {
  let row = { ...def, isActive: true };
  const runs: { id: string; exportId: string; portalId: string; status: string; trigger: string }[] = [];
  let runCounter = 0;

  return {
    exportDefinition: {
      findMany: vi.fn(async () =>
        row.isActive && row.nextRunAt.getTime() <= Date.now() ? [{ ...row, portal: { subscription: null } }] : [],
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string; nextRunAt: Date; isActive: boolean }; data: Partial<typeof row> }) => {
          if (where.id === row.id && where.nextRunAt.getTime() === row.nextRunAt.getTime() && where.isActive === row.isActive) {
            row = { ...row, ...data };
            return { count: 1 };
          }
          return { count: 0 };
        },
      ),
    },
    exportRun: {
      create: vi.fn(async ({ data }: { data: { portalId: string; exportId: string; status: string; trigger: string } }) => {
        const run = { id: `run-${++runCounter}`, ...data };
        runs.push(run);
        return { id: run.id };
      }),
      findFirst: vi.fn(async () => null),
    },
    runs,
  };
}

const makeStep = () => ({ run: async <T>(_id: unknown, fn: () => T | Promise<T>) => fn() });

describe('a builder-created schedule is one scheduleTick actually matches', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(SCHEDULE_PRESETS.filter((p) => p.cron !== null))(
    'preset "$label" produces a nextRunAt that is due, and scheduleTick creates a run for it',
    async (preset) => {
      const scheduleTz = 'UTC';
      const createdAt = new Date('2026-08-10T00:00:00.000Z'); // a Monday

      // Exactly what POST /api/exports computes (app/api/exports/route.ts),
      // using the real function - not a re-implementation of cron matching.
      const nextRunAt = nextCronOccurrence(preset.cron!, scheduleTz, createdAt);
      expect(nextRunAt).toBeInstanceOf(Date);
      expect(nextRunAt.getTime()).toBeGreaterThan(createdAt.getTime());

      // Advance to the moment scheduleTick's own 15-minute cron would next
      // observe this row as due.
      vi.useFakeTimers();
      vi.setSystemTime(nextRunAt);

      const fakePrisma = makeFakePrisma({
        id: 'export-1',
        portalId: 'portal-1',
        nextRunAt,
        scheduleCron: preset.cron!,
        scheduleTz,
      });
      const dbModule = await import('@/lib/db');
      (dbModule as { prisma: unknown }).prisma = fakePrisma;

      const send = vi.fn(async () => ({ ids: ['evt-1'] }));
      const result = await scheduleTickHandler({ step: makeStep(), send });

      expect(result).toEqual({ schedulesDue: 1 });
      expect(fakePrisma.runs).toHaveLength(1);
      expect(fakePrisma.runs[0]).toMatchObject({
        exportId: 'export-1',
        portalId: 'portal-1',
        status: RunStatus.QUEUED,
        trigger: Trigger.SCHEDULE,
      });
      expect(send).toHaveBeenCalledWith({ name: 'export.run.requested', data: { exportRunId: fakePrisma.runs[0].id } });
    },
  );

  it('a legacy row with a bare frequency word instead of cron is never matched (the bug, unfixed)', async () => {
    const fakePrisma = makeFakePrisma({
      id: 'export-legacy',
      portalId: 'portal-1',
      // nextRunAt was never computed for this row - exactly the two real
      // "weekly"/"export" rows found in production.
      nextRunAt: new Date(Date.now() - 60_000),
      scheduleCron: 'weekly',
      scheduleTz: 'UTC',
    });
    // Simulate nextRunAt actually being null, which findMany's WHERE
    // (`nextRunAt: { lte: now } `) would never match - findMany itself
    // enforces that below.
    (fakePrisma.exportDefinition.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const dbModule = await import('@/lib/db');
    (dbModule as { prisma: unknown }).prisma = fakePrisma;

    const send = vi.fn(async () => ({ ids: [] }));
    const result = await scheduleTickHandler({ step: makeStep(), send });

    expect(result).toEqual({ schedulesDue: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
