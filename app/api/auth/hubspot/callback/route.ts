import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { encrypt } from '@/lib/crypto';
import { createSession, consumeStateCookie } from '@/lib/session';
import { exchangeCodeForTokens, introspect, expiresAtFrom, getScopes } from '@/lib/hubspot/oauth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

function fail(req: NextRequest, reason: string) {
  const url = new URL('/login', req.nextUrl.origin);
  url.searchParams.set('error', reason);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  if (params.get('error')) return fail(req, 'denied');

  const code = params.get('code');
  if (!code) return fail(req, 'missing_code');

  // CSRF. Single-use: consume before doing anything else.
  if (!(await consumeStateCookie(params.get('state')))) return fail(req, 'state_mismatch');

  try {
    const tokens = await exchangeCodeForTokens(code);
    const info = await introspect(tokens.access_token);

    const portal = await prisma.portal.upsert({
      where: { hubspotPortalId: BigInt(info.hub_id) },
      create: {
        hubspotPortalId: BigInt(info.hub_id),
        hubDomain: info.hub_domain,
        accessTokenEnc: encrypt(tokens.access_token),
        refreshTokenEnc: encrypt(tokens.refresh_token),
        tokenExpiresAt: expiresAtFrom(tokens),
        scopes: info.scopes ?? getScopes(),
      },
      update: {
        hubDomain: info.hub_domain,
        accessTokenEnc: encrypt(tokens.access_token),
        refreshTokenEnc: encrypt(tokens.refresh_token),
        tokenExpiresAt: expiresAtFrom(tokens),
        scopes: info.scopes ?? getScopes(),
        disconnectedAt: null, // reconnecting clears the disconnected flag
      },
    });

    const user = await prisma.user.upsert({
      where: {
        portalId_hubspotUserId: { portalId: portal.id, hubspotUserId: BigInt(info.user_id) },
      },
      create: {
        portalId: portal.id,
        hubspotUserId: BigInt(info.user_id),
        email: info.user,
        lastLoginAt: new Date(),
      },
      update: { email: info.user, lastLoginAt: new Date() },
    });

    await createSession({
      portalId: portal.id,
      hubspotPortalId: portal.hubspotPortalId.toString(),
      userId: user.id,
    });

    return NextResponse.redirect(new URL('/dashboard', req.nextUrl.origin));
  } catch (err) {
    // Never log the error object wholesale: the request body we sent contained
    // a secret. logger.error still runs everything through lib/scrub.ts, but
    // passing only the message (not `err` itself) means there's nothing for
    // that scrub to need to catch here in the first place.
    logger.error('oauth callback failed', { message: err instanceof Error ? err.message : 'unknown' });
    return fail(req, 'exchange_failed');
  }
}
