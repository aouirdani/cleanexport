/**
 * GET /api/runs?exportId=&limit=30 - specs/06-API-CONTRACT.md.
 * portalId always comes from the session, never a request parameter -
 * lib/runs.ts's listRuns() puts it in the WHERE clause itself.
 */
import { NextResponse } from 'next/server';
import { readSession } from '@/lib/session';
import { AppError, ErrorCode } from '@/lib/errors';
import { listRuns } from '@/lib/runs';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json(new AppError(ErrorCode.NOT_AUTHENTICATED, 'Not signed in', 401).toJSON(), {
      status: 401,
    });
  }

  const url = new URL(req.url);
  const exportId = url.searchParams.get('exportId') ?? undefined;
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam === null ? undefined : Number(limitParam);

  const runs = await listRuns(session.portalId, { exportId, limit });

  return NextResponse.json({ runs });
}
