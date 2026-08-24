import { describe, it, expect, afterEach } from 'vitest';
import { types } from 'pg';
// Not part of `pg`'s public API surface, but there is no public export that
// serializes a Date the way a real query parameter would be built - and
// that serialization is exactly the other half of the round-trip this test
// exists to prove. Reaching into pg/lib/utils.js accepts a small amount of
// fragility (a pg upgrade could move this) in exchange for exercising pg's
// REAL behaviour rather than a reimplementation of our own that could
// silently drift from what actually happens in production.
import { createRequire } from 'node:module';
const { prepareValue } = createRequire(import.meta.url)('pg/lib/utils.js') as {
  prepareValue: (value: unknown) => unknown;
};

const TIMESTAMP_NO_TZ_OID = 1114; // Postgres OID for "timestamp without time zone" - every DateTime column in prisma/schema.prisma.

/**
 * THE SCHEDULE-TICK INCIDENT (lib/db.ts's own header comment has the full
 * story): every DateTime column here is a bare Postgres TIMESTAMP, not
 * TIMESTAMPTZ. `pg` serializes/parses that column type using the
 * CONNECTING PROCESS's LOCAL timezone, not UTC. A schedule's `nextRunAt`
 * written by a process observing one zone and read back by a process
 * observing a different one comes out shifted by exactly the difference -
 * which is exactly why a genuinely-due export was never picked up by
 * inngest/scheduleTick.ts in production (Europe/Paris summer offset, +2h).
 */
describe('the schedule-tick timezone incident - pg round-trips a TIMESTAMP(3) value through LOCAL time, not UTC', () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it('reproduces the bug: the SAME instant, written and read by processes in different zones, round-trips to a DIFFERENT value', () => {
    process.env.TZ = 'Europe/Paris'; // CEST (UTC+2) in August - matches the incident exactly.
    const trueInstant = new Date('2026-08-24T18:16:48Z'); // the reported nextRunAt

    // What a write from this (Europe/Paris) process sends as a query
    // parameter for this column.
    const writtenByParisProcess = prepareValue(trueInstant) as string;
    expect(writtenByParisProcess).toBe('2026-08-24T20:16:48.000+02:00'); // local wall clock + a computed offset

    // Postgres silently ignores any timezone indication for a column
    // declared TIMESTAMP (not TIMESTAMPTZ) - documented behaviour, not a
    // pg quirk - and returns the literal wall-clock portion, in its own
    // space-separated text format, on a later SELECT.
    const storedInPostgres = writtenByParisProcess.replace('T', ' ').replace(/[+-]\d{2}:\d{2}$/, '');
    expect(storedInPostgres).toBe('2026-08-24 20:16:48.000');

    // Read back by the SAME (Europe/Paris) process: the local-time
    // interpretation cancels out and recovers the true instant.
    const readBackByParisProcess = types.getTypeParser(TIMESTAMP_NO_TZ_OID)(storedInPostgres) as Date;
    expect(readBackByParisProcess.getTime()).toBe(trueInstant.getTime());

    // Read back by a DIFFERENT process observing UTC (e.g. a different
    // deployment/host for the same database) - it does NOT cancel out.
    process.env.TZ = 'UTC';
    const readBackByUtcProcess = types.getTypeParser(TIMESTAMP_NO_TZ_OID)(storedInPostgres) as Date;
    expect(readBackByUtcProcess.getTime()).not.toBe(trueInstant.getTime());

    // Shifted forward by exactly the CEST offset - a schedule that was
    // genuinely due looks two hours in the future to this reader, and
    // `nextRunAt: { lte: now } ` never selects it. This is the entire bug:
    // not a wrong query, a wrong VALUE the query correctly compared.
    const twoHoursMs = 2 * 60 * 60 * 1000;
    expect(readBackByUtcProcess.getTime() - trueInstant.getTime()).toBe(twoHoursMs);
  });

  it('lib/db.ts pins process.env.TZ to UTC as an import-time side effect, which eliminates the round-trip entirely', async () => {
    process.env.TZ = 'Europe/Paris'; // prove the import itself changes this, not that it was already UTC
    process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db';

    await import('@/lib/db');

    expect(process.env.TZ).toBe('UTC');

    // With TZ pinned, the write side and the read side both operate in
    // true UTC - the same value comes back regardless of what the
    // underlying OS/container's own default timezone happens to be.
    const trueInstant = new Date('2026-08-24T18:16:48Z');
    const written = prepareValue(trueInstant) as string;
    const storedInPostgres = written.replace('T', ' ').replace(/[+-]\d{2}:\d{2}$/, '');
    const readBack = types.getTypeParser(TIMESTAMP_NO_TZ_OID)(storedInPostgres) as Date;

    expect(readBack.getTime()).toBe(trueInstant.getTime());
  });
});
