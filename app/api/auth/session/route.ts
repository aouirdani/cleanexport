import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/lib/currentPortal';
import { AppError, ErrorCode } from '@/lib/errors';

export const dynamic = 'force-dynamic';

const MESSAGE_FOR_REASON: Record<'NOT_AUTHENTICATED' | 'SESSION_INVALID', string> = {
  NOT_AUTHENTICATED: 'Not signed in',
  SESSION_INVALID: 'Portal no longer exists',
};

export async function GET() {
  const current = await getCurrentSession();

  if (!current.ok) {
    return NextResponse.json(
      new AppError(ErrorCode[current.reason], MESSAGE_FOR_REASON[current.reason], 401).toJSON(),
      { status: 401 },
    );
  }

  return NextResponse.json({ portal: current.portal, user: current.user });
}
