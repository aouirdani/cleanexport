import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { readSession } from '@/lib/session';
import { AppError, ErrorCode } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await readSession();
  if (!session) {
    return NextResponse.json(
      new AppError(ErrorCode.NOT_AUTHENTICATED, 'Not signed in', 401).toJSON(),
      { status: 401 },
    );
  }

  const portal = await prisma.portal.findUnique({
    where: { id: session.portalId },
    // Explicit select: never let a token field reach a response by accident.
    select: { id: true, hubspotPortalId: true, name: true, hubDomain: true, disconnectedAt: true },
  });

  if (!portal) {
    return NextResponse.json(
      new AppError(ErrorCode.SESSION_INVALID, 'Portal no longer exists', 401).toJSON(),
      { status: 401 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, firstName: true, lastName: true },
  });

  return NextResponse.json({
    portal: { ...portal, hubspotPortalId: portal.hubspotPortalId.toString() },
    user,
  });
}
