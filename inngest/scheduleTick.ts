/**
 * export.schedule.tick - specs/02-ARCHITECTURE.md section 4: every 15
 * minutes, find due schedules and emit export.run.requested for each.
 *
 * No cron-parsing library is a project dependency (adding one is out of
 * scope for this file - scope is inngest/ + app/api/inngest/route.ts, not
 * package.json), so this implements a minimal 5-field cron matcher
 * (minute hour day-of-month month day-of-week; `*`, lists, ranges, steps -
 * no named months/weekdays, no `@daily`-style shorthands) and finds the next
 * occurrence by brute-force minute stepping. That is intentionally simple
 * rather than clever: a closed-form "next cron occurrence" calculation is a
 * well-known source of off-by-one and DST bugs, and this only ever runs once
 * per due export per 15-minute tick, so raw iteration cost is irrelevant.
 *
 * Idempotency: claiming a due schedule is a compare-and-swap on
 * ExportDefinition.nextRunAt (updateMany matching the exact value just read).
 * Only the caller whose update actually matched a row creates the ExportRun
 * and sends the event. A retry of this same step (e.g. the claim succeeded
 * but sending the event failed before the step returned) finds the QUEUED
 * run it already created and resends the event for that row instead of
 * creating a second one or losing the tick - and export.run.requested's own
 * `idempotency: event.data.exportRunId` protects against a duplicate send
 * spawning a second run of the same export.
 */

import { inngest } from './client';
import { prisma } from '@/lib/db';
import { RunStatus, Trigger } from '@/lib/generated/prisma/client';
import { isSubscriptionLapsed } from '@/lib/plan';

function cronFieldMatches(value: number, field: string, min: number, max: number): boolean {
  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(\*|\d+(?:-\d+)?)\/(\d+)$/);
    if (stepMatch) {
      const [, rangePart, stepStr] = stepMatch;
      const step = Number(stepStr);
      const [rangeStart, rangeEnd] = rangePart === '*' ? [min, max] : rangePart.split('-').map(Number);
      const end = rangeEnd ?? rangeStart;
      for (let v = rangeStart; v <= end; v += step) if (v === value) return true;
      continue;
    }
    if (part === '*') return true;
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      if (value >= start && value <= end) return true;
      continue;
    }
    if (Number(part) === value) return true;
  }
  return false;
}

/** A UTC-carrier Date whose getUTC* fields ARE the wall-clock time in `timeZone`. */
function zonedWallClock(instant: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const hour = get('hour') % 24; // Intl can report midnight as "24"
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second')));
}

function cronMatchesWallClock(wallClock: Date, cronExpr: string): boolean {
  const fields = cronExpr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Malformed cron expression: "${cronExpr}"`);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  return (
    cronFieldMatches(wallClock.getUTCMinutes(), minute, 0, 59) &&
    cronFieldMatches(wallClock.getUTCHours(), hour, 0, 23) &&
    cronFieldMatches(wallClock.getUTCDate(), dayOfMonth, 1, 31) &&
    cronFieldMatches(wallClock.getUTCMonth() + 1, month, 1, 12) &&
    cronFieldMatches(wallClock.getUTCDay(), dayOfWeek, 0, 6)
  );
}

const MAX_LOOKAHEAD_MINUTES = 60 * 24 * 366 * 2; // give up after ~2 years rather than loop forever on a bad expression

export function nextCronOccurrence(cronExpr: string, timeZone: string, after: Date): Date {
  let candidate = new Date(Math.ceil(after.getTime() / 60_000) * 60_000 + 60_000);

  for (let i = 0; i < MAX_LOOKAHEAD_MINUTES; i++) {
    if (cronMatchesWallClock(zonedWallClock(candidate, timeZone), cronExpr)) return candidate;
    candidate = new Date(candidate.getTime() + 60_000);
  }
  throw new Error(`No occurrence of cron "${cronExpr}" (${timeZone}) found within 2 years`);
}

/**
 * The handler, exported separately from the InngestFunction it's wired into
 * below so tests/inngest/scheduleTick.test.ts can call it directly with fake
 * step/prisma objects and no live Inngest runtime. `InngestFn` under-specifies
 * `step`/`send` to just the surface this handler actually uses.
 */
export interface InngestFn {
  step: { run: <T>(idOrOptions: string | { id: string }, fn: () => T | Promise<T>) => Promise<T> };
  send?: (event: { name: string; data: unknown }) => Promise<unknown>;
}

export async function scheduleTickHandler({ step, send = inngest.send.bind(inngest) }: InngestFn) {
  const now = new Date();

  const due = await step.run('find-due-schedules', () =>
    prisma.exportDefinition.findMany({
      where: {
        isActive: true,
        scheduleCron: { not: null },
        nextRunAt: { lte: now },
        portal: { disconnectedAt: null },
      },
      select: {
        id: true,
        portalId: true,
        scheduleCron: true,
        scheduleTz: true,
        nextRunAt: true,
        portal: { select: { subscription: { select: { status: true, trialEndsAt: true, pastDueSince: true } } } },
      },
    }),
  );

  for (const exp of due) {
    await step.run(`claim-and-run-${exp.id}`, async () => {
      // A lapsed subscription (expired trial, past-due beyond its grace
      // period, or canceled) means "no NEW run" - not a failure. Leaving
      // nextRunAt untouched (rather than claiming/advancing it) means this
      // schedule is simply re-evaluated, and skipped again, on every future
      // tick until the subscription is current - no failure email, no
      // ExportRun row at all for this tick.
      if (isSubscriptionLapsed(exp.portal.subscription, now)) return;

      // scheduleCron/nextRunAt are non-null by the query above.
      const next = nextCronOccurrence(exp.scheduleCron!, exp.scheduleTz, now);

      const claim = await prisma.exportDefinition.updateMany({
        where: { id: exp.id, nextRunAt: exp.nextRunAt, isActive: true },
        data: { nextRunAt: next, lastRunAt: now },
      });

      let run: { id: string } | null;
      if (claim.count === 1) {
        run = await prisma.exportRun.create({
          data: { portalId: exp.portalId, exportId: exp.id, status: RunStatus.QUEUED, trigger: Trigger.SCHEDULE },
          select: { id: true },
        });
      } else {
        // Someone else already claimed this tick for this schedule, or this
        // step is being retried after its own claim already succeeded.
        run = await prisma.exportRun.findFirst({
          where: { exportId: exp.id, trigger: Trigger.SCHEDULE, status: RunStatus.QUEUED },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        if (!run) return; // already progressed past QUEUED - nothing left to do
      }

      await send({ name: 'export.run.requested', data: { exportRunId: run.id } });
    });
  }

  return { schedulesDue: due.length };
}

export const scheduleTick = inngest.createFunction(
  { id: 'export-schedule-tick', triggers: [{ cron: '*/15 * * * *' }] },
  scheduleTickHandler,
);
