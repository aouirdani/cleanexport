import { describe, it, expect, beforeEach, vi } from 'vitest';

// export-stale-runs-sweep - "A run stuck in QUEUED disables 'Run now' for
// that export forever... A cleanup cron marks runs older than 30 minutes in
// QUEUED/RUNNING as FAILED with a clear errorCode." No live Prisma: a small
// stateful fake, same shape/spirit as tests/inngest/cleanup.test.ts's.

vi.mock('@/inngest/client', () => ({
  inngest: { createFunction: (_config: unknown, handler: unknown) => handler },
}));

vi.mock('@/lib/db', () => ({ prisma: undefined }));

const MINUTE_MS = 60 * 1000;

interface FakeRun {
  id: string;
  status: string;
  createdAt: Date;
}

function makeFakePrisma(runs: FakeRun[]) {
  const store = new Map(runs.map((r) => [r.id, { ...r }]));
  return {
    exportRun: {
      findMany: vi.fn(
        async ({
          where,
          orderBy,
          take,
        }: {
          where: { status: { in: string[] }; createdAt: { lt: Date } };
          orderBy: { createdAt: string };
          take: number;
        }) => {
          let results = [...store.values()].filter(
            (r) => where.status.in.includes(r.status) && r.createdAt < where.createdAt.lt,
          );
          results = results.sort((a, b) =>
            orderBy.createdAt === 'asc'
              ? a.createdAt.getTime() - b.createdAt.getTime()
              : b.createdAt.getTime() - a.createdAt.getTime(),
          );
          return results.slice(0, take).map((r) => ({ id: r.id, status: r.status }));
        },
      ),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; status: string }; data: Partial<FakeRun> }) => {
        const row = store.get(where.id);
        if (!row || row.status !== where.status) return { count: 0 };
        store.set(where.id, { ...row, ...data });
        return { count: 1 };
      }),
    },
    state: { store },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

async function setPrisma(p: FakePrisma) {
  const dbModule = await import('@/lib/db');
  (dbModule as unknown as { prisma: FakePrisma }).prisma = p;
}

function makeStep(afterStep?: Record<string, () => void>) {
  return {
    run: async <T>(idOrOptions: string | { id: string }, fn: () => T | Promise<T>) => {
      const result = await fn();
      const id = typeof idOrOptions === 'string' ? idOrOptions : idOrOptions.id;
      afterStep?.[id]?.();
      return result;
    },
  };
}

type Handler = (args: { step: ReturnType<typeof makeStep> }) => Promise<{ staleCount: number; failedCount: number }>;

beforeEach(() => {
  vi.resetModules();
});

describe('staleRunsSweep', () => {
  it('marks a 31-minute-old QUEUED run as FAILED with errorCode TIMEOUT', async () => {
    const { staleRunsSweep } = await import('@/inngest/staleRuns');
    const fakePrisma = makeFakePrisma([{ id: 'stuck-1', status: 'QUEUED', createdAt: new Date(Date.now() - 31 * MINUTE_MS) }]);
    await setPrisma(fakePrisma);

    const result = await (staleRunsSweep as unknown as Handler)({ step: makeStep() });

    expect(result).toEqual({ staleCount: 1, failedCount: 1 });
    const row = fakePrisma.state.store.get('stuck-1')!;
    expect(row.status).toBe('FAILED');
    expect((row as unknown as { errorCode: string }).errorCode).toBe('TIMEOUT');
    expect((row as unknown as { finishedAt: Date }).finishedAt).toBeInstanceOf(Date);
  });

  it('marks a stale RUNNING run too', async () => {
    const { staleRunsSweep } = await import('@/inngest/staleRuns');
    const fakePrisma = makeFakePrisma([{ id: 'stuck-2', status: 'RUNNING', createdAt: new Date(Date.now() - 45 * MINUTE_MS) }]);
    await setPrisma(fakePrisma);

    const result = await (staleRunsSweep as unknown as Handler)({ step: makeStep() });

    expect(result.failedCount).toBe(1);
    expect(fakePrisma.state.store.get('stuck-2')!.status).toBe('FAILED');
  });

  it('leaves a 5-minute-old QUEUED run alone', async () => {
    const { staleRunsSweep } = await import('@/inngest/staleRuns');
    const fakePrisma = makeFakePrisma([{ id: 'fresh-1', status: 'QUEUED', createdAt: new Date(Date.now() - 5 * MINUTE_MS) }]);
    await setPrisma(fakePrisma);

    const result = await (staleRunsSweep as unknown as Handler)({ step: makeStep() });

    expect(result).toEqual({ staleCount: 0, failedCount: 0 });
    expect(fakePrisma.state.store.get('fresh-1')!.status).toBe('QUEUED');
  });

  it('never touches a terminal run (SUCCESS/FAILED), no matter how old', async () => {
    const { staleRunsSweep } = await import('@/inngest/staleRuns');
    const fakePrisma = makeFakePrisma([
      { id: 'done-1', status: 'SUCCESS', createdAt: new Date(Date.now() - 365 * 24 * 60 * MINUTE_MS) },
      { id: 'failed-1', status: 'FAILED', createdAt: new Date(Date.now() - 365 * 24 * 60 * MINUTE_MS) },
    ]);
    await setPrisma(fakePrisma);

    const result = await (staleRunsSweep as unknown as Handler)({ step: makeStep() });

    expect(result).toEqual({ staleCount: 0, failedCount: 0 });
  });

  it('is idempotent: a run already failed by a previous tick (or a race) is not double-counted', async () => {
    const { staleRunsSweep } = await import('@/inngest/staleRuns');
    // Only still-QUEUED/RUNNING rows are ever selected in the first place -
    // simulate the race by having updateMany's status guard reject a row
    // that flipped to a terminal state between the find and the update.
    const fakePrisma = makeFakePrisma([{ id: 'raced', status: 'QUEUED', createdAt: new Date(Date.now() - 31 * MINUTE_MS) }]);
    await setPrisma(fakePrisma);

    // Simulate a concurrent completion landing right after the
    // find-stale-runs step reads the row but before this run's own
    // fail-raced step tries to claim it.
    const step = makeStep({
      'find-stale-runs': () => {
        fakePrisma.state.store.set('raced', {
          id: 'raced',
          status: 'SUCCESS',
          createdAt: new Date(Date.now() - 31 * MINUTE_MS),
        });
      },
    });

    const result = await (staleRunsSweep as unknown as Handler)({ step });

    expect(result).toEqual({ staleCount: 1, failedCount: 0 }); // found it, but the guarded update didn't match
    expect(fakePrisma.state.store.get('raced')!.status).toBe('SUCCESS'); // untouched
  });
});
