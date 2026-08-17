/**
 * specs/04-HUBSPOT-INTEGRATION.md section 2: "On 400 invalid_grant during
 * refresh: the user revoked access. Set Portal.disconnectedAt, disable all
 * schedules, email the user with a reconnect link. Do not retry."
 *
 * Shared by inngest/exportRun.ts (a revocation surfaces mid-run, via
 * HubSpotClient's onRevoked hook) and inngest/tokenRefresh.ts (the hourly
 * proactive refresh hits it directly). Both call this same function so the
 * "disable schedules" behaviour can't drift between the two paths.
 */

import { prisma } from '@/lib/db';
import { sendReconnectEmail, buildReconnectUrl } from './email';

/**
 * Two separately-guarded concerns, deliberately not folded into one check:
 *
 *  - The DB writes (disconnectedAt, clearing scheduleCron) are guarded by a
 *    compare-and-swap on disconnectedAt, so only the first caller to observe
 *    the revocation (across however many concurrent exports, or a concurrent
 *    refresh, hit it for the same portal) performs them.
 *  - The email is always attempted, with a stable per-portal idempotency key
 *    (Resend dedupes on that key itself). If the CAS win and the email send
 *    were bundled into a single "only the winner emails" guard, a retry after
 *    the DB write succeeded but the email send failed would see the CAS
 *    already lost and skip the email forever - the exact silent-failure this
 *    function exists to prevent.
 */
export async function disablePortalOnRevocation(portalId: string): Promise<void> {
  const { count } = await prisma.portal.updateMany({
    where: { id: portalId, disconnectedAt: null },
    data: { disconnectedAt: new Date() },
  });

  if (count === 1) {
    // scheduleCron: null = manual only (schema comment) - distinct from
    // isActive=false, which the API contract (DELETE /api/exports/:id)
    // reserves for soft-deleted exports. Revocation pauses schedules, it
    // doesn't delete them.
    await prisma.exportDefinition.updateMany({
      where: { portalId, scheduleCron: { not: null } },
      data: { scheduleCron: null },
    });
  }

  const users = await prisma.user.findMany({ where: { portalId }, select: { email: true } });
  await sendReconnectEmail({
    recipients: users.map((u) => u.email),
    idempotencyKey: `portal-reconnect-${portalId}`,
    reconnectUrl: buildReconnectUrl(),
  });
}
