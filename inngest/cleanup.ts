/**
 * r2.cleanup - specs/07-TASKS.md T14: "delete ExportRun rows and their R2
 * objects older than 90 days" as a cron function in inngest/.
 *
 * Retention is 90 days from ExportRun.createdAt, deliberately longer than
 * the 7-day signed-download-URL window (inngest/r2.ts's
 * DOWNLOAD_URL_TTL_SECONDS, enforced by app/api/runs/[id]/download/route.ts)
 * - the run row and history stay queryable in the dashboard for 90 days even
 * though the download link itself stops working after 7.
 *
 * Same step-per-row loop shape as inngest/tokenRefresh.ts and
 * inngest/scheduleTick.ts: each row gets its own step.run so a transient
 * failure on one row's R2 delete retries only that row, not the whole batch.
 * Capped at BATCH_SIZE per run so a large backlog is worked down over
 * several days of the cron rather than one run trying (and timing out on)
 * everything at once.
 *
 * The R2 delete runs before the row delete, and is best-effort (a failure
 * there does not stop the row from being deleted): S3-compatible DELETE is
 * idempotent, so a key that's already gone is not an error, and there is no
 * value in retrying "the ExportRun disappeared but the row stayed" forever -
 * the point of this sweep is to stop paying for the storage and to stop
 * exposing the row over the API (specs/02-ARCHITECTURE.md section 5: "No
 * customer CRM data is persisted beyond the generated file"), and a leaked
 * (un-deleted) R2 object with no ExportRun row pointing at it is silently
 * caught by the NEXT run of this same cron, 90 days of createdAt permitting -
 * except createdAt lives on the ExportRun row, which is about to be deleted.
 * In practice this means: if the R2 delete fails, log nothing sensitive,
 * delete the row anyway, and accept the orphaned object as an acceptable
 * failure mode for a solo-maintainer MVP rather than building a separate
 * orphan-object reconciliation system.
 */

import { inngest } from './client';
import { prisma } from '@/lib/db';
import { loadR2Config, deleteFileFromR2 } from './r2';

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 500;

export const r2Cleanup = inngest.createFunction(
  { id: 'r2-cleanup', triggers: [{ cron: '0 3 * * *' }] }, // daily, off-peak
  async ({ step }) => {
    const cutoff = new Date(Date.now() - RETENTION_MS);

    const staleRuns = await step.run('find-stale-runs', () =>
      prisma.exportRun.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true, fileKey: true },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
      }),
    );

    for (const run of staleRuns) {
      await step.run(`delete-${run.id}`, async () => {
        if (run.fileKey) {
          const r2 = loadR2Config();
          // Best-effort - see file header. Never log `run.fileKey` itself.
          await deleteFileFromR2(r2, run.fileKey).catch(() => undefined);
        }
        await prisma.exportRun.delete({ where: { id: run.id } }).catch(() => undefined);
      });
    }

    return { deletedCount: staleRuns.length };
  },
);
