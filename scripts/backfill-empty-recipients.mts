#!/usr/bin/env -S npx tsx
/**
 * One-off repair for ExportDefinition rows saved with recipients: [] -
 * before POST /api/exports (app/api/exports/route.ts) started defaulting an
 * empty submitted list to the session user's email, a run against one of
 * these rows completed, marked SUCCESS, and delivered nothing - the exact
 * silent-failure specs/05-EXPORT-ENGINE.md section 8 forbids. New rows can
 * no longer get created this way; this backfills the ones that already
 * exist.
 *
 * Per row: recipients <- [portal's most-recently-logged-in user's email].
 * Every portal in production has exactly one User row, but a portal with
 * more than one picks the most recent login as the best guess for "the
 * person who'd actually notice this export" - a portal with zero users
 * (should not happen; Portal/User are created together in the OAuth
 * callback) is skipped and reported rather than guessed at.
 *
 * Idempotent - rerunning after a row has been fixed (recipients no longer
 * empty) is a no-op for that row. Safe to run against production.
 *
 * Run with:
 *   npx tsx scripts/backfill-empty-recipients.mts [--apply]
 * Without --apply, it only prints what it would change (dry run). Loads
 * .env from the repo root the same way every other script in scripts/
 * does (see scripts/e2e-export.mts) - run from the repo root.
 */

import 'dotenv/config';
import { prisma } from '@/lib/db';

const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  const candidates = await prisma.exportDefinition.findMany({
    where: { recipients: { isEmpty: true } },
    select: { id: true, name: true, portalId: true },
  });

  if (candidates.length === 0) {
    console.log('No rows need repair.');
    return;
  }

  let fixed = 0;
  let skipped = 0;

  for (const exp of candidates) {
    const user = await prisma.user.findFirst({
      where: { portalId: exp.portalId },
      orderBy: [{ lastLoginAt: 'desc' }, { createdAt: 'asc' }],
      select: { email: true },
    });

    if (!user) {
      skipped++;
      console.warn(`[skipping] export ${exp.id} ("${exp.name}"): portal ${exp.portalId} has no users - cannot guess a recipient.`);
      continue;
    }

    fixed++;
    console.log(`[${APPLY ? 'fixing' : 'would fix'}] export ${exp.id} ("${exp.name}"): recipients -> ["${user.email}"]`);

    if (APPLY) {
      await prisma.exportDefinition.update({ where: { id: exp.id }, data: { recipients: [user.email] } });
    }
  }

  console.log(`\n${fixed} row(s) ${APPLY ? 'fixed' : 'fixable'}, ${skipped} row(s) skipped (no portal user).`);
  if (!APPLY) console.log('Rerun with --apply to write these changes.');
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
