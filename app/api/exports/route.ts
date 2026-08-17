/**
 * POST /api/exports - specs/06-API-CONTRACT.md, the save step of
 * specs/07-TASKS.md T17's builder flow. Only POST: the builder page
 * (app/(app)/dashboard/exports/new/page.tsx) is the only caller in this
 * task, and specs/AGENTS.md rule 1 ("implement the task given, nothing
 * else") is why list/get/patch/delete/run/preview aren't here too - those
 * belong to whichever task actually needs them.
 */
import { NextResponse } from 'next/server';
import { readSession } from '@/lib/session';
import { AppError, ErrorCode } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { CreateExportSchema } from '@/lib/schemas';
import { assertWithinPlan } from '@/lib/plan';
// Read-only import of a pure function - inngest/scheduleTick.ts itself is
// untouched. Reusing its cron matcher here (rather than a second
// hand-rolled one) is what keeps `nextRunAt` and the cron tick's own
// understanding of "due" from drifting apart - see that file's query,
// `nextRunAt: { lte: now }`: a schedule created with nextRunAt left null
// would never be picked up at all.
import { nextCronOccurrence } from '@/inngest/scheduleTick';

export const dynamic = 'force-dynamic';

function errorResponse(err: AppError) {
  return NextResponse.json(err.toJSON(), { status: err.status });
}

export async function POST(req: Request) {
  const session = await readSession();
  if (!session) {
    return errorResponse(new AppError(ErrorCode.NOT_AUTHENTICATED, 'Not signed in', 401));
  }

  const json = await req.json().catch(() => null);
  if (json === null) {
    return errorResponse(new AppError(ErrorCode.VALIDATION_FAILED, 'Request body must be valid JSON', 400));
  }

  const parsed = CreateExportSchema.safeParse(json);
  if (!parsed.success) {
    return errorResponse(
      new AppError(ErrorCode.VALIDATION_FAILED, parsed.error.issues.map((i) => i.message).join('; '), 400),
    );
  }
  const data = parsed.data;

  try {
    await assertWithinPlan(session.portalId, 'CREATE_EXPORT');
    if (data.scheduleCron) await assertWithinPlan(session.portalId, 'CREATE_SCHEDULE');
  } catch (err) {
    if (err instanceof AppError) return errorResponse(err);
    throw err;
  }

  let nextRunAt: Date | null = null;
  if (data.scheduleCron) {
    try {
      nextRunAt = nextCronOccurrence(data.scheduleCron, data.scheduleTz, new Date());
    } catch (err) {
      // Fail loudly (specs/AGENTS.md rule 10) rather than silently saving a
      // schedule that export.schedule.tick can never match.
      const message = err instanceof Error ? err.message : 'Invalid schedule';
      return errorResponse(new AppError(ErrorCode.VALIDATION_FAILED, message, 400));
    }
  }

  const created = await prisma.exportDefinition.create({
    data: {
      portalId: session.portalId,
      name: data.name,
      objectType: data.objectType,
      properties: data.properties,
      headerStyle: data.headerStyle,
      ...(data.filters ? { filters: data.filters } : {}),
      ...(data.associations ? { associations: data.associations } : {}),
      scheduleCron: data.scheduleCron ?? null,
      scheduleTz: data.scheduleTz,
      recipients: data.recipients,
      nextRunAt,
    },
  });

  return NextResponse.json({ export: created }, { status: 201 });
}
