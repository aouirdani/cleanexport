import { NextResponse } from 'next/server';
import { buildAuthorizeUrl } from '@/lib/hubspot/oauth';
import { newState, setStateCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = newState();
  await setStateCookie(state);
  return NextResponse.redirect(buildAuthorizeUrl(state));
}
