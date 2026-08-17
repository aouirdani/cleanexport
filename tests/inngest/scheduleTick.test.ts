import { describe, it, expect, vi } from 'vitest';
import { scheduleTickHandler } from '@/inngest/scheduleTick';
import { RunStatus, Trigger } from '@/lib/generated/prisma/client';

// Requirement 5: two concurrent ticks on the same due schedule must produce
// exactly one ExportRun, not two. scheduleTick.ts claims a due schedule with
// a compare-and-swap on ExportDefinition.nextRunAt (updateMany matching the
// exact nextRunAt value just read) - only the caller whose update actually
// matches a row creates the run and sends the event; the loser reuses the
// QUEUED run the winner already created.
//
// No real prisma here - a small stateful fake standing in for exactly the
// two tables this handler touches (ExportDefinition, ExportRun), with an
// `updateMany` that only "matches" when the where-clause's nextRunAt still
// equals the currently-stored value. That check-then-write happens with no
// `await` in between, so it is atomic across a JS event-loop tick even when
// two handler invocations are raced via Promise.all.

vi.mock('@/lib/db', () => ({ prisma: undefined })); // never actually used - see makeFakePrisma below

interface FakeExportRun {
  id: string;
  portalId: string;
  exportId: string;
  status: string;
  trigger: string;
  createdAt: Date;
}

function makeFakePrisma(initial: { id: string; portalId: string; nextRunAt: Date; scheduleCron: string; scheduleTz: string }) {
  let def = { ...initial, isActive: true };
  const runs: FakeExportRun[] = [];
  let runCounter = 0;

  return {
    exportDefinition: {
      findMany: vi.fn(async () => (def.isActive && def.nextRunAt.getTime() <= Date.now() ? [{ ...def }] : [])),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; nextRunAt: Date; isActive: boolean }; data: Partial<typeof def> }) => {
        if (where.id === def.id && where.nextRunAt.getTime() === def.nextRunAt.getTime() && where.isActive === def.isActive) {
          def = { ...def, ...data };
          return { count: 1 };
        }
        return { count: 0 };
      }),
    },
    exportRun: {
      create: vi.fn(async ({ data }: { data: { portalId: string; exportId: string; status: string; trigger: string } }) => {
        const run: FakeExportRun = { id: `run-${++runCounter}`, createdAt: new Date(), ...data };
        runs.push(run);
        return { id: run.id };
      }),
      findFirst: vi.fn(async ({ where }: { where: { exportId: string; trigger: string; status: string } }) => {
        const matches = runs
          .filter((r) => r.exportId === where.exportId && r.trigger === where.trigger && r.status === where.status)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return matches[0] ? { id: matches[0].id } : null;
      }),
    },
    runs,
  };
}

function makeStep() {
  return { run: async <T>(_id: unknown, fn: () => T | Promise<T>) => fn() };
}

const DUE_SCHEDULE = {
  id: 'export-1',
  portalId: 'portal-1',
  nextRunAt: new Date(Date.now() - 60_000), // one minute overdue
  scheduleCron: '*/15 * * * *',
  scheduleTz: 'UTC',
};

describe('scheduleTickHandler - compare-and-swap prevents a double-claimed schedule from producing two runs', () => {
  it('two concurrent ticks on the same due schedule produce exactly one ExportRun and one event', async () => {
    const fakePrisma = makeFakePrisma(DUE_SCHEDULE);
    // scheduleTick.ts imports { prisma } from '@/lib/db' at module scope, so
    // the mock above is set once; inject the stateful fake via the same
    // binding by re-mocking the module's export directly.
    const dbModule = await import('@/lib/db');
    (dbModule as { prisma: unknown }).prisma = fakePrisma;

    const sentEvents: { name: string; data: unknown }[] = [];
    const send = vi.fn(async (event: { name: string; data: unknown }) => {
      sentEvents.push(event);
      return { ids: ['evt-1'] };
    });

    // Both invocations read the same due-list before either claims - the
    // realistic "concurrent" case, not one that trivially finishes first.
    await Promise.all([
      scheduleTickHandler({ step: makeStep(), send }),
      scheduleTickHandler({ step: makeStep(), send }),
    ]);

    expect(fakePrisma.runs).toHaveLength(1);
    expect(fakePrisma.runs[0]).toMatchObject({
      exportId: DUE_SCHEDULE.id,
      portalId: DUE_SCHEDULE.portalId,
      status: RunStatus.QUEUED,
      trigger: Trigger.SCHEDULE,
    });

    // Both invocations still send the event (for the run the winner created) -
    // export.run.requested's own idempotency (event.data.exportRunId) is what
    // makes a duplicate send harmless, not scheduleTick suppressing it.
    expect(sentEvents).toHaveLength(2);
    expect(sentEvents[0].data).toEqual({ exportRunId: fakePrisma.runs[0].id });
    expect(sentEvents[1].data).toEqual({ exportRunId: fakePrisma.runs[0].id });

    // updateMany was attempted twice (both ticks tried to claim), but only
    // one of those attempts actually matched a row.
    expect(fakePrisma.exportDefinition.updateMany).toHaveBeenCalledTimes(2);
  });

  it('a single tick claims the schedule and advances nextRunAt to a real future occurrence', async () => {
    const fakePrisma = makeFakePrisma(DUE_SCHEDULE);
    const dbModule = await import('@/lib/db');
    (dbModule as { prisma: unknown }).prisma = fakePrisma;

    const send = vi.fn(async () => ({ ids: ['evt-1'] }));
    const result = await scheduleTickHandler({ step: makeStep(), send });

    expect(result).toEqual({ schedulesDue: 1 });
    expect(fakePrisma.runs).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);

    const [[updateCall]] = fakePrisma.exportDefinition.updateMany.mock.calls;
    expect(updateCall.data.nextRunAt).toBeInstanceOf(Date);
    expect((updateCall.data.nextRunAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('a schedule that is not due yet produces no run', async () => {
    const fakePrisma = makeFakePrisma({ ...DUE_SCHEDULE, nextRunAt: new Date(Date.now() + 60 * 60_000) });
    const dbModule = await import('@/lib/db');
    (dbModule as { prisma: unknown }).prisma = fakePrisma;

    const send = vi.fn(async () => ({ ids: [] }));
    const result = await scheduleTickHandler({ step: makeStep(), send });

    expect(result).toEqual({ schedulesDue: 0 });
    expect(fakePrisma.runs).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
  });
});
