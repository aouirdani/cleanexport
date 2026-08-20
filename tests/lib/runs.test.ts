import { describe, it, expect, vi, beforeEach } from 'vitest';

// lib/runs.ts - specs/06-API-CONTRACT.md's GET /api/runs, GET /api/runs/:id;
// specs/01-PRD.md A8 ("last 30 runs"). No live DB: prisma.exportRun is a
// small in-memory fake.

interface FakeRun {
  id: string;
  portalId: string;
  exportId: string;
  status: string;
  trigger: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  rowCount: number | null;
  fileSizeBytes: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  export: { name: string };
}

function makeRun(overrides: Partial<FakeRun> & { id: string }): FakeRun {
  return {
    portalId: 'portal-1',
    exportId: 'export-1',
    status: 'SUCCESS',
    trigger: 'MANUAL',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    finishedAt: new Date('2026-01-01T00:05:00Z'),
    rowCount: 10,
    fileSizeBytes: 1024,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    export: { name: 'My Export' },
    ...overrides,
  };
}

let runs: FakeRun[] = [];

vi.mock('@/lib/db', () => ({
  prisma: {
    exportRun: {
      findMany: vi.fn(async ({ where, orderBy, take, select }: {
        where: { portalId: string; exportId?: string | { in: string[] } };
        orderBy: { createdAt: 'asc' | 'desc' };
        take?: number;
        select: Record<string, unknown>;
      }) => {
        let results = runs.filter((r) => r.portalId === where.portalId);
        if (typeof where.exportId === 'string') {
          results = results.filter((r) => r.exportId === where.exportId);
        } else if (where.exportId && 'in' in where.exportId) {
          const ids = where.exportId.in;
          results = results.filter((r) => ids.includes(r.exportId));
        }
        results = [...results].sort((a, b) =>
          orderBy.createdAt === 'desc' ? b.createdAt.getTime() - a.createdAt.getTime() : a.createdAt.getTime() - b.createdAt.getTime(),
        );
        if (take) results = results.slice(0, take);
        // Mimic Prisma's `select` shape closely enough for toListItem to work.
        return results.map((r) => ('export' in select ? r : { ...r, export: undefined }));
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; portalId: string } }) => {
        const found = runs.find((r) => r.id === where.id && r.portalId === where.portalId);
        return found ?? null;
      }),
    },
  },
}));

const { listRuns, getRun, getLatestRunPerExport, isRunStale, RUN_HISTORY_LIMIT, STALE_RUN_MS } = await import(
  '@/lib/runs'
);

beforeEach(() => {
  runs = [];
  vi.clearAllMocks();
});

describe('listRuns', () => {
  it('scopes strictly by portalId - a run from another portal never appears', async () => {
    runs = [makeRun({ id: 'r1', portalId: 'portal-1' }), makeRun({ id: 'r2', portalId: 'portal-2' })];

    const result = await listRuns('portal-1');

    expect(result.map((r) => r.id)).toEqual(['r1']);
  });

  it('an exportId belonging to another portal returns an empty list, not another portal\'s runs', async () => {
    runs = [makeRun({ id: 'r1', portalId: 'portal-2', exportId: 'export-x' })];

    const result = await listRuns('portal-1', { exportId: 'export-x' });

    expect(result).toEqual([]);
  });

  it('orders newest first', async () => {
    runs = [
      makeRun({ id: 'old', createdAt: new Date('2026-01-01T00:00:00Z') }),
      makeRun({ id: 'new', createdAt: new Date('2026-01-02T00:00:00Z') }),
    ];

    const result = await listRuns('portal-1');

    expect(result.map((r) => r.id)).toEqual(['new', 'old']);
  });

  it('never returns more than RUN_HISTORY_LIMIT (30) even if asked for more', async () => {
    runs = Array.from({ length: 40 }, (_, i) =>
      makeRun({ id: `r${i}`, createdAt: new Date(Date.now() - i * 1000) }),
    );

    const result = await listRuns('portal-1', { limit: 1000 });

    expect(result).toHaveLength(RUN_HISTORY_LIMIT);
  });

  it('clamps a zero or negative limit up to the default rather than returning nothing', async () => {
    runs = [makeRun({ id: 'r1' })];

    expect(await listRuns('portal-1', { limit: 0 })).toHaveLength(1);
    expect(await listRuns('portal-1', { limit: -5 })).toHaveLength(1);
  });

  it('carries the exportName through from the joined ExportDefinition', async () => {
    runs = [makeRun({ id: 'r1', export: { name: 'Weekly Deals' } })];

    const result = await listRuns('portal-1');

    expect(result[0].exportName).toBe('Weekly Deals');
  });

  it('never truncates errorMessage', async () => {
    const longMessage = 'x'.repeat(5000);
    runs = [makeRun({ id: 'r1', status: 'FAILED', errorCode: 'TIMEOUT', errorMessage: longMessage })];

    const result = await listRuns('portal-1');

    expect(result[0].errorMessage).toHaveLength(5000);
    expect(result[0].errorMessage).toBe(longMessage);
  });
});

describe('getRun', () => {
  it('returns null for a run belonging to another portal - same as not found', async () => {
    runs = [makeRun({ id: 'r1', portalId: 'portal-2' })];

    expect(await getRun('portal-1', 'r1')).toBeNull();
  });

  it('returns null for an id that does not exist at all', async () => {
    expect(await getRun('portal-1', 'does-not-exist')).toBeNull();
  });

  it('returns the full run, including the complete errorMessage', async () => {
    const longMessage = 'HubSpot rate-limited this portal even after retrying. '.repeat(50);
    runs = [makeRun({ id: 'r1', status: 'FAILED', errorMessage: longMessage })];

    const result = await getRun('portal-1', 'r1');

    expect(result?.errorMessage).toBe(longMessage);
  });
});

describe('getLatestRunPerExport', () => {
  it('returns an empty map for an empty exportIds list without querying', async () => {
    const { prisma } = await import('@/lib/db');
    const result = await getLatestRunPerExport('portal-1', []);

    expect(result.size).toBe(0);
    expect(prisma.exportRun.findMany).not.toHaveBeenCalled();
  });

  it('picks the most recent run per export id', async () => {
    runs = [
      makeRun({ id: 'a-old', exportId: 'export-a', status: 'FAILED', createdAt: new Date('2026-01-01T00:00:00Z') }),
      makeRun({ id: 'a-new', exportId: 'export-a', status: 'SUCCESS', createdAt: new Date('2026-01-05T00:00:00Z') }),
      makeRun({ id: 'b-only', exportId: 'export-b', status: 'RUNNING', createdAt: new Date('2026-01-03T00:00:00Z') }),
    ];

    const result = await getLatestRunPerExport('portal-1', ['export-a', 'export-b']);

    expect(result.get('export-a')?.id).toBe('a-new');
    expect(result.get('export-a')?.status).toBe('SUCCESS');
    expect(result.get('export-b')?.id).toBe('b-only');
  });

  it('flags a stale QUEUED/RUNNING run so the dashboard does not treat it as in-flight forever', async () => {
    runs = [
      makeRun({
        id: 'stuck',
        exportId: 'export-a',
        status: 'QUEUED',
        createdAt: new Date(Date.now() - 31 * 60 * 1000),
      }),
    ];

    const result = await getLatestRunPerExport('portal-1', ['export-a']);

    expect(result.get('export-a')?.stale).toBe(true);
  });

  it('a fresh QUEUED/RUNNING run is not stale', async () => {
    runs = [
      makeRun({
        id: 'fresh',
        exportId: 'export-a',
        status: 'RUNNING',
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
      }),
    ];

    const result = await getLatestRunPerExport('portal-1', ['export-a']);

    expect(result.get('export-a')?.stale).toBe(false);
  });
});

// Requirement: "A run in QUEUED or RUNNING for more than 30 minutes is
// considered stale" - isRunStale is the one place that decides this, shared
// by lib/runs.ts's own toListItem/getLatestRunPerExport,
// app/api/exports/[id]/run/route.ts, and inngest/staleRuns.ts.
describe('isRunStale', () => {
  it('a 31-minute-old QUEUED run is stale', () => {
    expect(isRunStale({ status: 'QUEUED' as never, createdAt: new Date(Date.now() - 31 * 60 * 1000) })).toBe(true);
  });

  it('a 5-minute-old QUEUED run is not stale', () => {
    expect(isRunStale({ status: 'QUEUED' as never, createdAt: new Date(Date.now() - 5 * 60 * 1000) })).toBe(false);
  });

  it('a 31-minute-old RUNNING run is stale', () => {
    expect(isRunStale({ status: 'RUNNING' as never, createdAt: new Date(Date.now() - 31 * 60 * 1000) })).toBe(true);
  });

  it('exactly at the 30-minute boundary is not yet stale ("older than", not "at least")', () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - STALE_RUN_MS);
    expect(isRunStale({ status: 'QUEUED' as never, createdAt }, now)).toBe(false);
  });

  it('one millisecond past the 30-minute boundary is stale', () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - STALE_RUN_MS - 1);
    expect(isRunStale({ status: 'QUEUED' as never, createdAt }, now)).toBe(true);
  });

  it('a terminal run (SUCCESS/FAILED/CANCELLED) is never stale, no matter how old', () => {
    const veryOld = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    expect(isRunStale({ status: 'SUCCESS' as never, createdAt: veryOld })).toBe(false);
    expect(isRunStale({ status: 'FAILED' as never, createdAt: veryOld })).toBe(false);
    expect(isRunStale({ status: 'CANCELLED' as never, createdAt: veryOld })).toBe(false);
  });
});
