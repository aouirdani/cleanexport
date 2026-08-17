import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// r2-cleanup - specs/07-TASKS.md T14: "delete ExportRun rows and their R2
// objects older than 90 days". No live Prisma or R2: prisma is a small
// stateful fake (same shape/spirit as tests/inngest/exportRun.test.ts's
// makeFakePrisma), and inngest/r2.ts is mocked at the module level so this
// test can assert exactly which keys got a delete call without a real R2
// endpoint, and without ever needing real R2 credentials.

const { deleteFileFromR2Mock, deletedKeys } = vi.hoisted(() => {
  const deletedKeys: string[] = [];
  const deleteFileFromR2Mock = vi.fn(async (_config: unknown, key: string) => {
    deletedKeys.push(key);
  });
  return { deleteFileFromR2Mock, deletedKeys };
});

vi.mock('@/inngest/r2', () => ({
  loadR2Config: () => ({ accountId: 'a', accessKeyId: 'b', secretAccessKey: 'c', bucket: 'd' }),
  deleteFileFromR2: deleteFileFromR2Mock,
}));

vi.mock('@/inngest/client', () => ({
  inngest: { createFunction: (_config: unknown, handler: unknown) => handler },
}));

vi.mock('@/lib/db', () => ({ prisma: undefined }));

const DAY_MS = 24 * 60 * 60 * 1000;

interface FakeRun {
  id: string;
  fileKey: string | null;
  createdAt: Date;
}

function makeFakePrisma(runs: FakeRun[]) {
  const store = new Map(runs.map((r) => [r.id, { ...r }]));
  return {
    exportRun: {
      findMany: vi.fn(async ({ where, orderBy, take }: { where: { createdAt: { lt: Date } }; orderBy: { createdAt: string }; take: number }) => {
        const results = [...store.values()].filter((r) => r.createdAt < where.createdAt.lt);
        results.sort((a, b) =>
          orderBy.createdAt === 'asc' ? a.createdAt.getTime() - b.createdAt.getTime() : b.createdAt.getTime() - a.createdAt.getTime(),
        );
        return results.slice(0, take).map((r) => ({ id: r.id, fileKey: r.fileKey }));
      }),
      delete: vi.fn(async ({ where: { id } }: { where: { id: string } }) => {
        if (!store.has(id)) throw new Error('fake prisma: not found');
        const row = store.get(id)!;
        store.delete(id);
        return row;
      }),
    },
    state: { store },
  };
}

type FakePrisma = ReturnType<typeof makeFakePrisma>;

async function setPrisma(fakePrisma: FakePrisma) {
  const dbModule = await import('@/lib/db');
  (dbModule as unknown as { prisma: FakePrisma }).prisma = fakePrisma;
}

function makeStep() {
  return {
    run: async <T>(idOrOptions: string | { id: string }, fn: () => T | Promise<T>) => fn(),
  };
}

beforeEach(() => {
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
  process.env.R2_BUCKET = 'test-bucket';
  deletedKeys.length = 0;
  deleteFileFromR2Mock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('r2Cleanup', () => {
  it('deletes ExportRun rows and their R2 objects older than 90 days, and leaves recent rows alone', async () => {
    const { r2Cleanup } = await import('@/inngest/cleanup');

    const now = Date.now();
    const fakePrisma = makeFakePrisma([
      { id: 'old-1', fileKey: 'exports/portal-1/aaa.xlsx', createdAt: new Date(now - 91 * DAY_MS) },
      { id: 'old-2', fileKey: 'exports/portal-1/bbb.xlsx', createdAt: new Date(now - 120 * DAY_MS) },
      { id: 'recent-1', fileKey: 'exports/portal-1/ccc.xlsx', createdAt: new Date(now - 10 * DAY_MS) },
    ]);
    await setPrisma(fakePrisma);

    const handler = r2Cleanup as unknown as (args: { step: ReturnType<typeof makeStep> }) => Promise<{ deletedCount: number }>;
    const result = await handler({ step: makeStep() });

    expect(result.deletedCount).toBe(2);
    expect(fakePrisma.state.store.has('old-1')).toBe(false);
    expect(fakePrisma.state.store.has('old-2')).toBe(false);
    expect(fakePrisma.state.store.has('recent-1')).toBe(true);

    expect(deletedKeys.sort()).toEqual(['exports/portal-1/aaa.xlsx', 'exports/portal-1/bbb.xlsx'].sort());
  });

  it('deletes the row even when it has no fileKey (upload never completed) - no R2 call attempted', async () => {
    const { r2Cleanup } = await import('@/inngest/cleanup');

    const now = Date.now();
    const fakePrisma = makeFakePrisma([{ id: 'old-no-key', fileKey: null, createdAt: new Date(now - 100 * DAY_MS) }]);
    await setPrisma(fakePrisma);

    const handler = r2Cleanup as unknown as (args: { step: ReturnType<typeof makeStep> }) => Promise<{ deletedCount: number }>;
    const result = await handler({ step: makeStep() });

    expect(result.deletedCount).toBe(1);
    expect(fakePrisma.state.store.has('old-no-key')).toBe(false);
    expect(deleteFileFromR2Mock).not.toHaveBeenCalled();
  });

  it('still deletes the row when the R2 delete fails - best-effort, does not block row cleanup', async () => {
    const { r2Cleanup } = await import('@/inngest/cleanup');
    deleteFileFromR2Mock.mockRejectedValueOnce(new Error('simulated R2 failure'));

    const now = Date.now();
    const fakePrisma = makeFakePrisma([{ id: 'old-1', fileKey: 'exports/portal-1/aaa.xlsx', createdAt: new Date(now - 100 * DAY_MS) }]);
    await setPrisma(fakePrisma);

    const handler = r2Cleanup as unknown as (args: { step: ReturnType<typeof makeStep> }) => Promise<{ deletedCount: number }>;
    const result = await handler({ step: makeStep() });

    expect(result.deletedCount).toBe(1);
    expect(fakePrisma.state.store.has('old-1')).toBe(false);
  });
});
