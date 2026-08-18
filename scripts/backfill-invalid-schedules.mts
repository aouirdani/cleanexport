#!/usr/bin/env -S npx tsx
/**
 * One-off repair for ExportDefinition rows written before scheduleCron was
 * validated server-side (lib/schemas.ts's CreateExportSchema, added with
 * POST /api/exports - every row created through that route already has a
 * real 5-field cron and a computed nextRunAt). Two known-bad rows exist
 * from that earlier, unvalidated window: scheduleCron = "weekly" and
 * scheduleCron = "export", both with nextRunAt left null - so
 * inngest/scheduleTick.ts's own due-schedule query
 * (`scheduleCron: { not: null }, nextRunAt: { lte: now }`) never selects
 * them. Not a bug in the tick or the API: dead data that predates both.
 *
 * What this does, per row with scheduleCron set and nextRunAt null:
 *   1. Already a valid 5-field cron? Just compute and save nextRunAt - the
 *      row was fine, it was only ever missing this one field.
 *   2. A bare frequency word this app's own schedule presets would have
 *      produced ("daily"/"weekly"/"monthly" - lib/schedulePresets.ts's
 *      LEGACY_FREQUENCY_WORDS)? Rewrite scheduleCron to the real cron
 *      expression and compute nextRunAt.
 *   3. Anything else (e.g. "export" - not a frequency word; recon/FINDINGS.md
 *      theory is a user typed the object-type question's own wording into
 *      the wrong field): unrecoverable - null scheduleCron rather than guess
 *      a schedule. Guessing would be inventing intent (specs/AGENTS.md rule
 *      10: fail loudly, not silently). Nulling it, instead of leaving the
 *      row non-null-but-broken, is a deliberate choice over the row's
 *      earlier state: components/dashboard/format.ts's describeSchedule()
 *      would otherwise keep showing "Schedule needs attention" forever,
 *      with no path to it ever resolving on its own. Nulling makes the
 *      dashboard correctly say "Manual only" - true once this runs - and a
 *      human who wants it scheduled again picks a real one through the
 *      builder, which validates it server-side (lib/schemas.ts).
 *
 * Idempotent - rerunning after a row has been fixed (nextRunAt no longer
 * null, or scheduleCron nulled) is a no-op for that row. Safe to run
 * against production.
 *
 * Run with:
 *   npx tsx scripts/backfill-invalid-schedules.mts [--apply]
 * Without --apply, it only prints what it would change (dry run). Loads
 * .env from the repo root the same way every other script in scripts/
 * does (see scripts/e2e-export.mts) - run from the repo root.
 */

import 'dotenv/config';
import { prisma } from '@/lib/db';
import { nextCronOccurrence } from '@/inngest/scheduleTick';
import { LEGACY_FREQUENCY_WORDS } from '@/lib/schedulePresets';

const CRON_SHAPE = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/;
const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  const candidates = await prisma.exportDefinition.findMany({
    where: { scheduleCron: { not: null }, nextRunAt: null },
    select: { id: true, name: true, scheduleCron: true, scheduleTz: true },
  });

  if (candidates.length === 0) {
    console.log('No schedules need repair.');
    return;
  }

  let fixed = 0;
  let nulled = 0;

  for (const exp of candidates) {
    const raw = exp.scheduleCron!;
    const asCron = CRON_SHAPE.test(raw) ? raw : LEGACY_FREQUENCY_WORDS[raw.trim().toLowerCase()];

    if (!asCron) {
      nulled++;
      console.warn(`[${APPLY ? 'nulling' : 'would null'}] export ${exp.id} ("${exp.name}"): scheduleCron "${raw}" ` +
        `is not a cron expression and not a recognized frequency word - unrecoverable, clearing it to "Manual only" ` +
        `rather than guessing a schedule.`);
      if (APPLY) {
        await prisma.exportDefinition.update({ where: { id: exp.id }, data: { scheduleCron: null, nextRunAt: null } });
      }
      continue;
    }

    let nextRunAt: Date;
    try {
      nextRunAt = nextCronOccurrence(asCron, exp.scheduleTz, new Date());
    } catch (err) {
      nulled++;
      console.warn(`[${APPLY ? 'nulling' : 'would null'}] export ${exp.id} ("${exp.name}"): cron "${asCron}" has no ` +
        `upcoming occurrence (${err instanceof Error ? err.message : String(err)}) - unrecoverable, clearing it.`);
      if (APPLY) {
        await prisma.exportDefinition.update({ where: { id: exp.id }, data: { scheduleCron: null, nextRunAt: null } });
      }
      continue;
    }

    fixed++;
    const change = asCron === raw ? `nextRunAt -> ${nextRunAt.toISOString()}` : `scheduleCron "${raw}" -> "${asCron}", nextRunAt -> ${nextRunAt.toISOString()}`;
    console.log(`[${APPLY ? 'fixing' : 'would fix'}] export ${exp.id} ("${exp.name}"): ${change}`);

    if (APPLY) {
      await prisma.exportDefinition.update({
        where: { id: exp.id },
        data: { scheduleCron: asCron, nextRunAt },
      });
    }
  }

  console.log(`\n${fixed} row(s) ${APPLY ? 'fixed' : 'fixable'}, ${nulled} row(s) ${APPLY ? 'cleared to Manual only' : 'unrecoverable (would be cleared to Manual only)'}.`);
  if (!APPLY) console.log('Rerun with --apply to write these changes.');
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
