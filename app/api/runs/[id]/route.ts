/**
 * GET /api/runs/:id - specs/06-API-CONTRACT.md: "single run with status."
 * Same scoping shape as the download route next to it: `getRun` puts
 * portalId in the query itself, so a run id from another portal 404s
 * exactly like one that doesn't exist - no separate ownership check that
 * could leak existence via a 403.
 */
import { NextResponse } from 'next/server';
import { readSession } from '@/lib/session';
import { AppError, ErrorCode } from '@/lib/errors';
import { getRun } from '@/lib/runs';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json(new AppError(ErrorCode.NOT_AUTHENTICATED, 'Not signed in', 401).toJSON(), {
      status: 401,
    });
  }

  const { id } = await params;
  const run = await getRun(session.portalId, id);

  if (!run) {
    return NextResponse.json(new AppError(ErrorCode.NOT_FOUND, 'Export run not found', 404).toJSON(), {
      status: 404,
    });
  }

  return NextResponse.json({ run });
}
