/**
 * POST /api/exports/preview - specs/06-API-CONTRACT.md, specs/07-TASKS.md
 * T18: previews an UNSAVED definition, straight from the builder's
 * in-progress state, so a user can see the file is correct before
 * committing to anything. No file is written, nothing is uploaded, no
 * ExportRun row is created - lib/exportPreview.ts's runPreview() only
 * calls HubSpot's read endpoints and returns rows in memory.
 *
 * Body validation reuses CreateExportSchema - the exact schema
 * POST /api/exports validates a save with (specs/07-TASKS.md T18: "the
 * unsaved-definition path validates with the same Zod schema as a save").
 * A definition that fails to preview because of a shape error would also
 * fail to save; keeping one schema means that can never drift.
 */
import { NextResponse } from 'next/server';
import { readSession } from '@/lib/session';
import { AppError, ErrorCode } from '@/lib/errors';
import { CreateExportSchema } from '@/lib/schemas';
import { HubSpotClient } from '@/lib/hubspot/client';
import { loadPropertyDefs, loadOwners } from '@/inngest/propertyDefs';
import { runPreview, classifyPreviewError } from '@/lib/exportPreview';
import type { ObjectType } from '@/lib/generated/prisma/client';

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
    // No onRevoked hook here, deliberately: exportRun.ts's real run disables
    // the portal and emails a reconnect link on revocation - a preview is a
    // read-only, possibly-repeated exploratory click while the user is
    // still editing, and shouldn't fan out portal-wide side effects or spam
    // reconnect emails. A genuinely revoked grant still gets caught for
    // real by the next scheduled/manual run or the hourly token-refresh
    // cron; this route just reports TOKEN_REVOKED back to this one request.
    const client = await HubSpotClient.forPortal(session.portalId);
    const propertyDefs = await loadPropertyDefs(client, session.portalId, data.objectType as ObjectType);
    const owners = await loadOwners(client);

    const result = await runPreview({
      client,
      propertyDefs,
      owners,
      definition: {
        objectType: data.objectType,
        properties: data.properties,
        headerStyle: data.headerStyle,
        filters: data.filters,
        associations: data.associations,
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    const classified = classifyPreviewError(err);
    return NextResponse.json({ error: { code: classified.code, message: classified.message } }, { status: classified.status });
  }
}
