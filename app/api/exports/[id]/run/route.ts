/**
 * POST /api/exports/:id/run - specs/06-API-CONTRACT.md: "202 { runId }.
 * Emits export.run.requested." The manual "Run now" trigger
 * (specs/07-TASKS.md T20's follow-up) that assertWithinPlan's RUN_EXPORT
 * action was written for but had no caller yet - see lib/plan.ts's header.
 *
 * Scoping: `findFirst({ where: { id, portalId } })`, same as every other
 * single-resource route (app/api/runs/[id]/route.ts,
 * app/api/exports/[id]/preview/route.ts) - an export id from another
 * portal 404s indistinguishably from one that doesn't exist, never a 403
 * that would confirm the row is there.
 *
 * Duplicate-click idempotency: before creating anything, this checks for a
 * run of THIS export already QUEUED or RUNNING and returns that run's id
 * instead of creating a second one. This is a read-then-create check, not a
 * database-level compare-and-swap (specs/03-DATA-MODEL.md's ExportRun has
 * no field to CAS on for "run now" the way ExportDefinition.nextRunAt lets
 * inngest/scheduleTick.ts do it) - it closes the ordinary double-click
 * window (the case this task asks for), not a true concurrent race between
 * two requests that both pass the check in the same instant. The Inngest
 * event is only sent for a NEWLY created run; a duplicate click reuses the
 * existing run's id without re-sending (export.run.requested's own
 * `idempotency: event.data.exportRunId` would make a resend harmless too,
 * but there is no reason to send it twice).
 *
 * Stale in-flight runs are not in-flight: a QUEUED/RUNNING row older than
 * lib/runs.ts's STALE_RUN_MS (30 minutes - inngest/staleRuns.ts's cron will
 * mark it FAILED on its own schedule, but a customer clicking "Run now"
 * should not have to wait for that tick) is failed right here, inline,
 * before falling through to the normal "nothing in flight" path below - the
 * bug this fixes is exactly a lost event leaving a row that never resolves
 * on its own, permanently blocking this export until someone intervenes.
 */
import { NextResponse } from 'next/server';
import { readSession } from '@/lib/session';
import { AppError, ErrorCode } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { assertWithinPlan } from '@/lib/plan';
import { isRunStale } from '@/lib/runs';
import { RunStatus, Trigger } from '@/lib/generated/prisma/client';
import { inngest } from '@/inngest/client';

export const dynamic = 'force-dynamic';

function errorResponse(err: AppError) {
  return NextResponse.json(err.toJSON(), { status: err.status });
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await readSession();
  if (!session) {
    return errorResponse(new AppError(ErrorCode.NOT_AUTHENTICATED, 'Not signed in', 401));
  }

  const { id } = await params;
  const exportDef = await prisma.exportDefinition.findFirst({
    where: { id, portalId: session.portalId },
    select: { id: true },
  });
  if (!exportDef) {
    return errorResponse(new AppError(ErrorCode.NOT_FOUND, 'Export not found', 404));
  }

  const inFlight = await prisma.exportRun.findFirst({
    where: { exportId: exportDef.id, status: { in: [RunStatus.QUEUED, RunStatus.RUNNING] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, createdAt: true },
  });
  if (inFlight && !isRunStale(inFlight)) {
    return NextResponse.json({ runId: inFlight.id }, { status: 202 });
  }
  if (inFlight) {
    // Status-guarded, same reasoning as inngest/staleRuns.ts: only fail it
    // if it's still in the exact state just read, so a genuine completion
    // racing this request isn't clobbered.
    await prisma.exportRun.updateMany({
      where: { id: inFlight.id, status: inFlight.status },
      data: {
        status: RunStatus.FAILED,
        finishedAt: new Date(),
        errorCode: ErrorCode.TIMEOUT,
        errorMessage:
          "This export never completed - it was stuck without progress for over 30 minutes and has been marked as failed.",
      },
    });
  }

  try {
    await assertWithinPlan(session.portalId, 'RUN_EXPORT');
  } catch (err) {
    if (err instanceof AppError) return errorResponse(err);
    throw err;
  }

  const run = await prisma.exportRun.create({
    data: { portalId: session.portalId, exportId: exportDef.id, status: RunStatus.QUEUED, trigger: Trigger.MANUAL },
    select: { id: true },
  });

  await inngest.send({ name: 'export.run.requested', data: { exportRunId: run.id } });

  return NextResponse.json({ runId: run.id }, { status: 202 });
}
