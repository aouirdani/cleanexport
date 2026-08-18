/**
 * POST /api/exports/:id/preview - specs/06-API-CONTRACT.md, specs/07-TASKS.md
 * T18: previews an already-SAVED definition. Same underlying pipeline as
 * POST /api/exports/preview (lib/exportPreview.ts's runPreview) - this
 * route's only job is to load the stored ExportDefinition and hand it to
 * that same function, scoped by portalId exactly like every other
 * single-resource route (app/api/runs/[id]/route.ts,
 * app/api/runs/[id]/download/route.ts): `findFirst({ where: { id, portalId } })`
 * so a definition id from another portal 404s indistinguishably from one
 * that doesn't exist, never a 403 that would confirm the row is there.
 */
import { NextResponse } from 'next/server';
import { readSession } from '@/lib/session';
import { AppError, ErrorCode } from '@/lib/errors';
import { prisma } from '@/lib/db';
import { FiltersSchema, AssociationsSchema } from '@/lib/schemas';
import { HubSpotClient } from '@/lib/hubspot/client';
import { loadPropertyDefs, loadOwners } from '@/inngest/propertyDefs';
import { runPreview, classifyPreviewError } from '@/lib/exportPreview';

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
  const exportDef = await prisma.exportDefinition.findFirst({ where: { id, portalId: session.portalId } });
  if (!exportDef) {
    return errorResponse(new AppError(ErrorCode.NOT_FOUND, 'Export not found', 404));
  }

  // Stored as validated JSON at save time (POST /api/exports uses this same
  // schema) - re-parsed defensively rather than cast, since a Prisma Json
  // column is `unknown` at the type level.
  const filters = FiltersSchema.nullable().optional().safeParse(exportDef.filters);
  const associations = AssociationsSchema.nullable().optional().safeParse(exportDef.associations);

  try {
    const client = await HubSpotClient.forPortal(session.portalId);
    const propertyDefs = await loadPropertyDefs(client, session.portalId, exportDef.objectType);
    const owners = await loadOwners(client);

    const result = await runPreview({
      client,
      propertyDefs,
      owners,
      definition: {
        objectType: exportDef.objectType,
        properties: exportDef.properties,
        headerStyle: exportDef.headerStyle,
        filters: filters.success ? (filters.data ?? undefined) : undefined,
        associations: associations.success ? (associations.data ?? undefined) : undefined,
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    const classified = classifyPreviewError(err);
    return NextResponse.json({ error: { code: classified.code, message: classified.message } }, { status: classified.status });
  }
}
