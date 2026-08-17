/**
 * The Inngest client - specs/02-ARCHITECTURE.md section 4.
 *
 * The three functions specced there register against this client:
 *   export.run.requested   (event)  - runs one export, writes file, sends email
 *   export.schedule.tick   (cron)   - every 15 min, finds due schedules
 *   hubspot.token.refresh  (cron)   - hourly, refreshes tokens expiring in < 2h
 * plus one more added by T14 (specs/07-TASKS.md), a cron with no event of
 * its own:
 *   r2-cleanup              (cron)   - daily, deletes ExportRun rows and their
 *                                      R2 objects older than 90 days
 */

import { Inngest } from 'inngest';

/** Event payloads this app emits and reacts to. Plain types, not schema-validated -
 *  every event here is only ever sent by inngest/scheduleTick.ts or a future
 *  manual-run API route, both of which construct the payload directly. */
export interface Events {
  'export.run.requested': {
    data: {
      /** ExportRun.id - the row must already exist (QUEUED), created by whoever emits this. */
      exportRunId: string;
    };
  };
  'export.schedule.tick': {
    data: Record<string, never>;
  };
  'hubspot.token.refresh': {
    data: Record<string, never>;
  };
}

export const inngest = new Inngest({ id: 'cleanexport' });
