/**
 * PATCH/DELETE /api/exports/:id - specs/06-API-CONTRACT.md.
 *
 * Both close the same gap: an export with a schedule had no way to be
 * stopped from the UI short of a database script - a `*\/5 * * * *`
 * schedule (now rejected at save time by lib/schemas.ts, but pre-existing
 * rows aren't retroactively fixed by a validation change) would exhaust an
 * email quota with nothing in the dashboard able to touch it.
 *
 * Scoping: `findFirst({ where: { id, portalId, deletedAt: null } })`, same
 * "404 not 403" pattern as every other single-resource route
 * (app/api/exports/[id]/run/route.ts, .../preview/route.ts,
 * app/api/runs/[id]/route.ts) - an id from another portal, or one already
 * soft-deleted, 404s indistinguishably from one that never existed.
 * Treating a soft-deleted row as not-found (not just filtering it from
 * lists) means PATCH/DELETE on an already-deleted export both fail the
 * same clean way, instead of a delete "succeeding" twice or a pause
 * silently reviving a deleted row.
 *
 * PATCH and DELETE both set `isActive: false` in their respective
 * "turn it off" paths, but they are NOT the same action - see
 * prisma/schema.prisma's `deletedAt` field comment for why a second field
 * exists at all: a paused export must stay visible and resumable; a
 * deleted one must not.
 */
import { NextResponse } from 'next/server';
import { readSession } from '@/lib/session';
import { AppError, ErrorCode } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { PatchExportSchema } from '@/lib/schemas';
import { nextCronOccurrence } from '@/inngest/scheduleTick';

export const dynamic = 'force-dynamic';

function errorResponse(err: AppError) {
  return NextResponse.json(err.toJSON(), { status: err.status });
}

async function findOwnedExport(id: string, portalId: string) {
  return prisma.exportDefinition.findFirst({
    where: { id, portalId, deletedAt: null },
    select: { id: true, isActive: true, scheduleCron: true, scheduleTz: true },
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await readSession();
  if (!session) {
    return errorResponse(new AppError(ErrorCode.NOT_AUTHENTICATED, 'Not signed in', 401));
  }

  const json = await req.json().catch(() => null);
  if (json === null) {
    return errorResponse(new AppError(ErrorCode.VALIDATION_FAILED, 'Request body must be valid JSON', 400));
  }

  const parsed = PatchExportSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(
      new AppError(ErrorCode.VALIDATION_FAILED, parsed.error.issues.map((i) => i.message).join('; '), 400),
    );
  }

  const { id } = await params;
  const exportDef = await findOwnedExport(id, session.portalId);
  if (!exportDef) {
    return errorResponse(new AppError(ErrorCode.NOT_FOUND, 'Export not found', 404));
  }

  const resuming = !exportDef.isActive && parsed.data.isActive;

  // Resuming a schedule recomputes nextRunAt from NOW, exactly like a fresh
  // save (app/api/exports/route.ts) - the alternative, leaving whatever
  // nextRunAt was stored before the pause, would very likely be in the
  // past by the time someone resumes, and export.schedule.tick would treat
  // that as "due" on its very next 15-minute tick: an immediate,
  // surprising catch-up run the moment "Resume" is clicked, for a
  // schedule the customer just chose to bring back deliberately, not to
  // fire right now.
  let nextRunAt: Date | undefined;
  if (resuming && exportDef.scheduleCron) {
    try {
      nextRunAt = nextCronOccurrence(exportDef.scheduleCron, exportDef.scheduleTz, new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid schedule';
      return errorResponse(new AppError(ErrorCode.VALIDATION_FAILED, message, 400));
    }
  }

  const updated = await prisma.exportDefinition.update({
    where: { id: exportDef.id },
    data: { isActive: parsed.data.isActive, ...(nextRunAt ? { nextRunAt } : {}) },
    select: { id: true, isActive: true, nextRunAt: true },
  });

  return NextResponse.json({ export: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await readSession();
  if (!session) {
    return errorResponse(new AppError(ErrorCode.NOT_AUTHENTICATED, 'Not signed in', 401));
  }

  const { id } = await params;
  const exportDef = await findOwnedExport(id, session.portalId);
  if (!exportDef) {
    return errorResponse(new AppError(ErrorCode.NOT_FOUND, 'Export not found', 404));
  }

  // isActive: false is what actually stops export.schedule.tick from
  // selecting this row (its own query filters on it directly) - deletedAt
  // is what makes the removal permanent/hidden rather than a pause. Both
  // are set here so this satisfies specs/06-API-CONTRACT.md's "soft
  // delete (isActive=false), cancels schedule" literally, while still
  // being distinguishable from a paused row.
  await prisma.exportDefinition.update({
    where: { id: exportDef.id },
    data: { isActive: false, deletedAt: new Date() },
  });

  return NextResponse.json({ success: true });
}
