/**
 * export.stale-runs.sweep - a run stuck in QUEUED or RUNNING with no
 * terminal transition ever coming (the export.run.requested event was
 * lost, or the process handling it died mid-step) previously blocked
 * "Run now" for that export forever, with no way out from the UI: the
 * record kept claiming to be in progress long after any real run could
 * still be running.
 *
 * specs/05-EXPORT-ENGINE.md section 8 already requires a 30-minute TIMEOUT
 * for a run that started but ran too long (inngest/exportRun.ts's
 * MAX_RUN_MS, enforced from inside the running step). This cron applies
 * the SAME 30-minute rule (lib/runs.ts's STALE_RUN_MS/isRunStale - one
 * constant, not two) to the case that in-process check can never catch: a
 * run that never started running at all. Every 5 minutes (well under the
 * 30-minute threshold, so nothing sits stale for long) it marks any
 * QUEUED/RUNNING run older than that as FAILED with errorCode TIMEOUT - the
 * same code a genuinely-overlong run gets - so the record stops lying about
 * being in progress.
 *
 * No failure email: unlike inngest/exportRun.ts's onFailure (which sends
 * one because ITS run definitely attempted and definitely failed), a run
 * this cron catches may never have been attempted at all (the event that
 * would have started it was the thing that got lost) - there's no
 * confidently-true story to email the customer, only "we stopped waiting."
 * The dashboard already surfaces this via lib/runs.ts's `stale` flag well
 * before this cron's next tick, and once it lands, run-status-badge.tsx
 * shows the row as FAILED like any other failed run.
 *
 * A status-guarded updateMany (not a blind update), same reasoning as
 * scheduleTick.ts's claim and exportRun.ts's mark-failed: this cron and a
 * genuine completion racing at the same instant must not both "win" -
 * whichever write actually still matches QUEUED/RUNNING is the one that
 * takes effect.
 */

import { inngest } from './client';
import { prisma } from '@/lib/db';
import { RunStatus } from '@/lib/generated/prisma/client';
import { ErrorCode } from '@/lib/errors';
import { STALE_RUN_MS } from '@/lib/runs';

const BATCH_SIZE = 500;

export const staleRunsSweep = inngest.createFunction(
  { id: 'export-stale-runs-sweep', triggers: [{ cron: '*/5 * * * *' }] },
  async ({ step }) => {
    const cutoff = new Date(Date.now() - STALE_RUN_MS);

    const stale = await step.run('find-stale-runs', () =>
      prisma.exportRun.findMany({
        where: { status: { in: [RunStatus.QUEUED, RunStatus.RUNNING] }, createdAt: { lt: cutoff } },
        select: { id: true, status: true },
        orderBy: { createdAt: 'asc' },
        take: BATCH_SIZE,
      }),
    );

    let failedCount = 0;
    for (const run of stale) {
      const result = await step.run(`fail-${run.id}`, () =>
        prisma.exportRun.updateMany({
          where: { id: run.id, status: run.status }, // still QUEUED/RUNNING as read above, not raced to a terminal state since
          data: {
            status: RunStatus.FAILED,
            finishedAt: new Date(),
            errorCode: ErrorCode.TIMEOUT,
            errorMessage:
              "This export never completed - it was stuck without progress for over 30 minutes and has been marked as failed. Use “Run now” to try again.",
          },
        }),
      );
      failedCount += result.count;
    }

    return { staleCount: stale.length, failedCount };
  },
);
