/**
 * Run-history reads - specs/06-API-CONTRACT.md's `GET /api/runs` and
 * `GET /api/runs/:id`, specs/01-PRD.md A8 ("Export history: last 30 runs").
 *
 * Shared by app/api/runs/route.ts, app/api/runs/[id]/route.ts, and
 * app/(app)/dashboard/runs/page.tsx's initial server-rendered fetch, so the
 * portal-scoping rule (every query takes portalId, never a bare id) lives in
 * one place rather than being re-implemented per caller.
 */
import { prisma } from '@/lib/db';
import { RunStatus, type Trigger } from '@/lib/generated/prisma/client';

/** specs/01-PRD.md A8: "last 30 runs" - the run-history table never shows more. */
export const RUN_HISTORY_LIMIT = 30;

/**
 * specs/05-EXPORT-ENGINE.md section 8's 30-minute TIMEOUT (inngest/exportRun.ts's
 * MAX_RUN_MS), applied to the case that spec section never covered: a run
 * whose export.run.requested event was lost, so it never even started. Such
 * a run sits in QUEUED (or RUNNING, if it started but then the process died
 * mid-step) forever unless something says otherwise - `isRunStale` is that
 * "otherwise," shared by the dashboard (treat it as not-in-flight) and
 * inngest/staleRuns.ts (the cron that actually marks it FAILED).
 */
export const STALE_RUN_MS = 30 * 60 * 1000;

/** A run is only ever "stale" while it's still claiming to be in flight - a terminal run is just old, not stale. */
export function isRunStale(run: { status: RunStatus; createdAt: Date }, now: Date = new Date()): boolean {
  if (run.status !== RunStatus.QUEUED && run.status !== RunStatus.RUNNING) return false;
  return now.getTime() - run.createdAt.getTime() > STALE_RUN_MS;
}

export interface RunListItem {
  id: string;
  exportId: string;
  exportName: string;
  status: RunStatus;
  trigger: Trigger;
  startedAt: Date | null;
  finishedAt: Date | null;
  rowCount: number | null;
  fileSizeBytes: number | null;
  /** Full, untruncated - the error page/table must never cut this off (specs/07-TASKS.md T19). */
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  /** True for a QUEUED/RUNNING run older than STALE_RUN_MS - see isRunStale. */
  stale: boolean;
}

const RUN_SELECT = {
  id: true,
  exportId: true,
  status: true,
  trigger: true,
  startedAt: true,
  finishedAt: true,
  rowCount: true,
  fileSizeBytes: true,
  errorCode: true,
  errorMessage: true,
  createdAt: true,
  export: { select: { name: true } },
} as const;

function toListItem(
  row: { export: { name: string } } & Omit<RunListItem, 'exportName' | 'stale'>,
  now: Date,
): RunListItem {
  const { export: exportDef, ...rest } = row;
  return { ...rest, exportName: exportDef.name, stale: isRunStale(row, now) };
}

/** Clamps a caller-supplied limit into (0, RUN_HISTORY_LIMIT] - never more than the spec allows, never zero or negative. */
function clampLimit(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested)) return RUN_HISTORY_LIMIT;
  return Math.min(Math.max(Math.trunc(requested), 1), RUN_HISTORY_LIMIT);
}

export async function listRuns(
  portalId: string,
  opts: { exportId?: string; limit?: number } = {},
): Promise<RunListItem[]> {
  const runs = await prisma.exportRun.findMany({
    // portalId is always in the WHERE clause itself, never applied as a
    // post-hoc filter - an exportId from another portal simply matches
    // nothing here, the same "scoped in the query, not checked after"
    // pattern as app/api/runs/[id]/download/route.ts.
    where: { portalId, ...(opts.exportId ? { exportId: opts.exportId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: clampLimit(opts.limit),
    select: RUN_SELECT,
  });

  const now = new Date();
  return runs.map((run) => toListItem(run, now));
}

export async function getRun(portalId: string, id: string): Promise<RunListItem | null> {
  const run = await prisma.exportRun.findFirst({
    where: { id, portalId },
    select: RUN_SELECT,
  });

  return run ? toListItem(run, new Date()) : null;
}

export interface LatestRunByExport {
  id: string;
  status: RunStatus;
  createdAt: Date;
  finishedAt: Date | null;
  rowCount: number | null;
  /** True for a QUEUED/RUNNING run older than STALE_RUN_MS - see isRunStale. */
  stale: boolean;
}

/**
 * One row per exportId - the most recent run for each, used by the
 * dashboard's export list. A single findMany + JS reduce rather than N
 * queries: at the plan limit of 10 export definitions (specs/06-API-CONTRACT.md
 * "Plan gating") this is a small result set either way, but one round trip
 * beats ten.
 */
export async function getLatestRunPerExport(
  portalId: string,
  exportIds: string[],
): Promise<Map<string, LatestRunByExport>> {
  if (exportIds.length === 0) return new Map();

  const runs = await prisma.exportRun.findMany({
    where: { portalId, exportId: { in: exportIds } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, exportId: true, status: true, createdAt: true, finishedAt: true, rowCount: true },
  });

  const now = new Date();
  const latest = new Map<string, LatestRunByExport>();
  for (const run of runs) {
    if (latest.has(run.exportId)) continue; // already-seen exportId is a later (older) row - orderBy desc
    latest.set(run.exportId, { ...run, stale: isRunStale(run, now) });
  }
  return latest;
}
