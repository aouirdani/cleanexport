/**
 * hubspot.token.refresh - specs/02-ARCHITECTURE.md section 4 (hourly cron);
 * specs/04-HUBSPOT-INTEGRATION.md section 2: "Refresh proactively on the
 * hourly cron for anything expiring in under 2 hours."
 *
 * Calls the OAuth token endpoint directly (lib/hubspot/oauth.ts's
 * refreshAccessToken), the same function HubSpotClient's own private
 * refresh() uses reactively - this just triggers it proactively, on a
 * schedule, without spending one of the portal's CRM API calls to do so.
 * Only accessTokenEnc and tokenExpiresAt are persisted, matching
 * HubSpotClient.refresh()'s own persist() call exactly (refreshTokenEnc is
 * never rewritten there either) - the two refresh paths must not drift.
 */

import { inngest } from './client';
import { prisma } from '@/lib/db';
import { decrypt, encrypt } from '@/lib/crypto';
import { refreshAccessToken, expiresAtFrom, GrantRevokedError } from '@/lib/hubspot/oauth';
import { disablePortalOnRevocation } from './revocation';

const REFRESH_MARGIN_MS = 2 * 60 * 60 * 1000; // 2 hours - matches lib/hubspot/client.ts's own margin

export const tokenRefresh = inngest.createFunction(
  { id: 'hubspot-token-refresh', triggers: [{ cron: '0 * * * *' }] },
  async ({ step }) => {
    const dueBy = new Date(Date.now() + REFRESH_MARGIN_MS);

    const portals = await step.run('find-expiring-portals', () =>
      prisma.portal.findMany({
        where: { disconnectedAt: null, tokenExpiresAt: { lt: dueBy } },
        select: { id: true, refreshTokenEnc: true },
      }),
    );

    for (const portal of portals) {
      await step.run(`refresh-${portal.id}`, async () => {
        try {
          const tokens = await refreshAccessToken(decrypt(portal.refreshTokenEnc));
          await prisma.portal.update({
            where: { id: portal.id },
            data: {
              accessTokenEnc: encrypt(tokens.access_token),
              tokenExpiresAt: expiresAtFrom(tokens),
            },
          });
        } catch (err) {
          if (err instanceof GrantRevokedError) {
            await disablePortalOnRevocation(portal.id);
            return; // handled - do not retry a revoked grant
          }
          throw err;
        }
      });
    }

    return { portalsRefreshed: portals.length };
  },
);
