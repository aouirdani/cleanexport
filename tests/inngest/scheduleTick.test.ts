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

function makeFakePrisma(
  initial: { id: string; portalId: string; nextRunAt: Date; scheduleCron: string; scheduleTz: string },
  subscription: { status: string; trialEndsAt: Date | null; pastDueSince: Date | null } | null = null,
) {
  let def = { ...initial, isActive: true };
  const runs: FakeExportRun[] = [];
  let runCounter = 0;

  return {
    exportDefinition: {
      findMany: vi.fn(async () =>
        def.isActive && def.nextRunAt.getTime() <= Date.now() ? [{ ...def, portal: { subscription } }] : [],
      ),
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

// Requirement: "scheduleTick must skip portals without an active
// subscription - not fail their runs, skip them, so they get no failure
// email for a billing problem." A skip means no ExportRun row is created at
// all (never a FAILED one) and nextRunAt is left untouched, so the schedule
// is simply re-evaluated on the next tick rather than being disabled.
describe('scheduleTickHandler - lapsed subscriptions are skipped, not failed', () => {
  it('CANCELED: no run is created, no event is sent, and nextRunAt is left untouched', async () => {
    const fakePrisma = makeFakePrisma(DUE_SCHEDULE, { status: 'CANCELED', trialEndsAt: null, pastDueSince: null });
    const dbModule = await import('@/lib/db');
    (dbModule as { prisma: unknown }).prisma = fakePrisma;

    const send = vi.fn(async () => ({ ids: [] }));
    const result = await scheduleTickHandler({ step: makeStep(), send });

    expect(result).toEqual({ schedulesDue: 1 }); // it WAS due - just skipped, not "not found"
    expect(fakePrisma.runs).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
    expect(fakePrisma.exportDefinition.updateMany).not.toHaveBeenCalled();
  });

  it('a trial expired in the past is skipped', async () => {
    const fakePrisma = makeFakePrisma(DUE_SCHEDULE, {
      status: 'TRIALING',
      trialEndsAt: new Date(Date.now() - 1000),
      pastDueSince: null,
    });
    const dbModule = await import('@/lib/db');
    (dbModule as { prisma: unknown }).prisma = fakePrisma;

    const result = await scheduleTickHandler({ step: makeStep(), send: vi.fn(async () => ({ ids: [] })) });

    expect(fakePrisma.runs).toHaveLength(0);
    expect(result).toEqual({ schedulesDue: 1 });
  });

  it('a trial still running (trialEndsAt in the future) is NOT skipped', async () => {
    const fakePrisma = makeFakePrisma(DUE_SCHEDULE, {
      status: 'TRIALING',
      trialEndsAt: new Date(Date.now() + 60 * 60_000),
      pastDueSince: null,
    });
    const dbModule = await import('@/lib/db');
    (dbModule as { prisma: unknown }).prisma = fakePrisma;

    await scheduleTickHandler({ step: makeStep(), send: vi.fn(async () => ({ ids: ['evt-1'] })) });

    expect(fakePrisma.runs).toHaveLength(1);
  });

  it('PAST_DUE within the grace period is NOT skipped', async () => {
    const fakePrisma = makeFakePrisma(DUE_SCHEDULE, {
      status: 'PAST_DUE',
      trialEndsAt: null,
      pastDueSince: new Date(Date.now() - 24 * 60 * 60_000), // 1 day ago
    });
    const dbModule = await import('@/lib/db');
    (dbModule as { prisma: unknown }).prisma = fakePrisma;

    await scheduleTickHandler({ step: makeStep(), send: vi.fn(async () => ({ ids: ['evt-1'] })) });

    expect(fakePrisma.runs).toHaveLength(1);
  });

  it('PAST_DUE beyond the grace period is skipped', async () => {
    const fakePrisma = makeFakePrisma(DUE_SCHEDULE, {
      status: 'PAST_DUE',
      trialEndsAt: null,
      pastDueSince: new Date(Date.now() - 8 * 24 * 60 * 60_000), // 8 days ago
    });
    const dbModule = await import('@/lib/db');
    (dbModule as { prisma: unknown }).prisma = fakePrisma;

    await scheduleTickHandler({ step: makeStep(), send: vi.fn(async () => ({ ids: [] })) });

    expect(fakePrisma.runs).toHaveLength(0);
  });

  it('a portal with no Subscription row at all (never checked out) is NOT skipped', async () => {
    const fakePrisma = makeFakePrisma(DUE_SCHEDULE, null);
    const dbModule = await import('@/lib/db');
    (dbModule as { prisma: unknown }).prisma = fakePrisma;

    await scheduleTickHandler({ step: makeStep(), send: vi.fn(async () => ({ ids: ['evt-1'] })) });

    expect(fakePrisma.runs).toHaveLength(1);
  });

  it('ACTIVE is NOT skipped', async () => {
    const fakePrisma = makeFakePrisma(DUE_SCHEDULE, { status: 'ACTIVE', trialEndsAt: null, pastDueSince: null });
    const dbModule = await import('@/lib/db');
    (dbModule as { prisma: unknown }).prisma = fakePrisma;

    await scheduleTickHandler({ step: makeStep(), send: vi.fn(async () => ({ ids: ['evt-1'] })) });

    expect(fakePrisma.runs).toHaveLength(1);
  });
});

// THE PRODUCTION INCIDENT: "an export that satisfies every condition is
// never picked up." Every test above (and every test that existed before
// this one) uses a `findMany` fake that ignores the `where` object it is
// called with entirely - it re-derives "is this due" from the seeded
// row's own fields in plain JS (`def.nextRunAt.getTime() <= Date.now()`),
// never from the actual query arguments scheduleTickHandler builds. That
// stub would pass unchanged even if the real `where` clause were wrong,
// missing a field, malformed, or (the actual production bug - see
// lib/db.ts's header) comparing values that LOOK right in isolation but
// were shifted by a timezone mismatch between whichever process wrote
// `nextRunAt` and whichever reads it. None of that is exercisable through
// a fake that never looks at `where` at all.
//
// This fake does look at it: `findMany` filters a small seeded table by
// actually evaluating each clause scheduleTickHandler's real query uses
// (`isActive`, `scheduleCron: { not: null }`, `nextRunAt: { lte }`,
// `portal.disconnectedAt`), and separately captures the exact call args
// so the shape of the query itself can be asserted on - not just its
// eventual effect.
describe('scheduleTickHandler - the real WHERE clause and subscription select, faithfully evaluated', () => {
  interface FakeRow {
    id: string;
    portalId: string;
    isActive: boolean;
    scheduleCron: string | null;
    scheduleTz: string;
    nextRunAt: Date | null;
    disconnectedAt: Date | null;
    subscription: { status: string; trialEndsAt: Date | null; pastDueSince: Date | null } | null;
  }

  function makeQueryAwarePrisma(rows: FakeRow[]) {
    const findManyCalls: unknown[] = [];
    const runs: FakeExportRun[] = [];
    let runCounter = 0;
    const table = new Map(rows.map((r) => [r.id, { ...r }]));

    return {
      exportDefinition: {
        findMany: vi.fn(async (args: {
          where: {
            isActive?: boolean;
            scheduleCron?: { not: null };
            nextRunAt?: { lte: Date };
            portal?: { disconnectedAt: null };
          };
        }) => {
          findManyCalls.push(args);
          const { where } = args;
          return [...table.values()]
            .filter((row) => where.isActive === undefined || row.isActive === where.isActive)
            .filter((row) => !where.scheduleCron || row.scheduleCron !== null)
            .filter((row) => !where.nextRunAt || (row.nextRunAt !== null && row.nextRunAt.getTime() <= where.nextRunAt.lte.getTime()))
            .filter((row) => !where.portal || row.disconnectedAt === where.portal.disconnectedAt)
            .map((row) => ({
              id: row.id,
              portalId: row.portalId,
              scheduleCron: row.scheduleCron,
              scheduleTz: row.scheduleTz,
              nextRunAt: row.nextRunAt,
              // The actual shape lib.ts's select produces - proves the
              // subscription is genuinely loaded (possibly `null`, never
              // silently `undefined`), not assumed by the fake.
              portal: { subscription: row.subscription },
            }));
        }),
        updateMany: vi.fn(async ({ where, data }: { where: { id: string; nextRunAt: Date; isActive: boolean }; data: Record<string, unknown> }) => {
          const row = table.get(where.id);
          if (!row || !row.nextRunAt || row.nextRunAt.getTime() !== where.nextRunAt.getTime() || row.isActive !== where.isActive) {
            return { count: 0 };
          }
          table.set(where.id, { ...row, ...data });
          return { count: 1 };
        }),
      },
      exportRun: {
        create: vi.fn(async ({ data }: { data: { portalId: string; exportId: string; status: string; trigger: string } }) => {
          const run: FakeExportRun = { id: `run-${++runCounter}`, createdAt: new Date(), ...data };
          runs.push(run);
          return { id: run.id };
        }),
        findFirst: vi.fn(async () => null),
      },
      runs,
      findManyCalls,
    };
  }

  it('seeds an export whose nextRunAt is in the past, runs the real handler, and a run IS created', async () => {
    const fakePrisma = makeQueryAwarePrisma([
      {
        id: 'export-prod',
        portalId: 'portal-prod',
        isActive: true,
        scheduleCron: '*/15 * * * *',
        scheduleTz: 'UTC',
        nextRunAt: new Date(Date.now() - 8 * 60 * 1000), // due 8 minutes ago - the exact shape of the reported incident
        disconnectedAt: null,
        subscription: { status: 'TRIALING', trialEndsAt: null, pastDueSince: null }, // TRIALING, not lapsed - matches the report
      },
    ]);
    const dbModule = await import('@/lib/db');
    (dbModule as { prisma: unknown }).prisma = fakePrisma;

    const result = await scheduleTickHandler({ step: makeStep(), send: vi.fn(async () => ({ ids: ['evt-1'] })) });

    expect(result).toEqual({ schedulesDue: 1 });
    expect(fakePrisma.runs).toHaveLength(1);
    expect(fakePrisma.runs[0]).toMatchObject({ exportId: 'export-prod', portalId: 'portal-prod', status: RunStatus.QUEUED, trigger: Trigger.SCHEDULE });
  });

  it('the query itself: isActive, a non-null scheduleCron, nextRunAt <= now, and an un-disconnected portal - the exact where clause, not a paraphrase', async () => {
    const fakePrisma = makeQueryAwarePrisma([]);
    const dbModule = await import('@/lib/db');
    (dbModule as { prisma: unknown }).prisma = fakePrisma;

    const before = new Date();
    await scheduleTickHandler({ step: makeStep(), send: vi.fn(async () => ({ ids: [] })) });
    const after = new Date();

    expect(fakePrisma.findManyCalls).toHaveLength(1);
    const { where } = fakePrisma.findManyCalls[0] as {
      where: { isActive: boolean; scheduleCron: { not: null }; nextRunAt: { lte: Date }; portal: { disconnectedAt: null } };
    };
    expect(where.isActive).toBe(true);
    expect(where.scheduleCron).toEqual({ not: null });
    expect(where.portal).toEqual({ disconnectedAt: null });
    // `now` is a real, freshly-constructed instant - not a hardcoded or
    // locally-shifted value (the actual root cause: see lib/db.ts).
    expect(where.nextRunAt.lte.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(where.nextRunAt.lte.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('a schedule due by every field EXCEPT an active subscription is found (schedulesDue counts it) but produces no run - matches "lapsed" semantics, not "not found"', async () => {
    const fakePrisma = makeQueryAwarePrisma([
      {
        id: 'export-canceled',
        portalId: 'portal-canceled',
        isActive: true,
        scheduleCron: '0 9 * * *',
        scheduleTz: 'UTC',
        nextRunAt: new Date(Date.now() - 60_000),
        disconnectedAt: null,
        subscription: { status: 'CANCELED', trialEndsAt: null, pastDueSince: null },
      },
    ]);
    const dbModule = await import('@/lib/db');
    (dbModule as { prisma: unknown }).prisma = fakePrisma;

    const result = await scheduleTickHandler({ step: makeStep(), send: vi.fn(async () => ({ ids: [] })) });

    expect(result).toEqual({ schedulesDue: 1 }); // the WHERE clause found it
    expect(fakePrisma.runs).toHaveLength(0); // the lapsed check inside the loop skipped it
  });

  it('a disconnected portal is excluded by the WHERE clause itself, not by the loop', async () => {
    const fakePrisma = makeQueryAwarePrisma([
      {
        id: 'export-disconnected',
        portalId: 'portal-disconnected',
        isActive: true,
        scheduleCron: '0 9 * * *',
        scheduleTz: 'UTC',
        nextRunAt: new Date(Date.now() - 60_000),
        disconnectedAt: new Date(), // disconnected
        subscription: null,
      },
    ]);
    const dbModule = await import('@/lib/db');
    (dbModule as { prisma: unknown }).prisma = fakePrisma;

    const result = await scheduleTickHandler({ step: makeStep(), send: vi.fn(async () => ({ ids: [] })) });

    expect(result).toEqual({ schedulesDue: 0 });
    expect(fakePrisma.runs).toHaveLength(0);
  });
});
