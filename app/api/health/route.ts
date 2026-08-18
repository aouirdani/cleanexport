/**
 * GET /api/health - specs/07-TASKS.md T22.
 *
 * Deliberately minimal: `{ ok, db, version }` and NOTHING else. No
 * environment variable names, no connection strings, no dependency
 * versions (Node/Next.js/Prisma/etc.) - only this app's own version, read
 * from package.json, the one version number that isn't configuration.
 * A DB failure is reported as `db: "error"` with no error detail attached
 * (a Postgres connection error can embed the connection string) - the
 * point of this endpoint is "is it up", not a diagnostic dump.
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { version } from '@/package.json';

export const dynamic = 'force-dynamic';

export async function GET() {
  let db: 'ok' | 'error' = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = 'error';
  }

  const ok = db === 'ok';
  return NextResponse.json({ ok, db, version }, { status: ok ? 200 : 503 });
}
