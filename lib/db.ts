/**
 * THE SCHEDULE-TICK INCIDENT: every DateTime column in prisma/schema.prisma
 * is a bare Postgres `TIMESTAMP(3)` - "without time zone" (see the
 * migration.sql under prisma/migrations; there is no `@db.Timestamptz`
 * anywhere). `pg` (node-postgres, which the adapter below hands Prisma's
 * queries to directly) does not serialize or parse Dates for that column
 * type as UTC by default - it uses the CONNECTING PROCESS's LOCAL system
 * timezone:
 *   - write: pg/lib/utils.js's `dateToString` builds the literal from
 *     `date.getFullYear()/getHours()/...` (LOCAL getters), not
 *     `getUTCFullYear()/getUTCHours()/...`.
 *   - read: pg-types' `parseDate` (OID 1114, "timestamp without time
 *     zone") falls back to `new Date(year, month, day, hour, ...)` - the
 *     LOCAL constructor - whenever the string carries no zone offset,
 *     which a `TIMESTAMP` column's output never does.
 * Both directions depend on `process.env.TZ` (or the OS default, in a
 * container without one set). Two processes that disagree - this app's
 * various deployments/hosts don't all necessarily share one default zone
 * - round-trip the exact same instant to two DIFFERENT stored/read
 * values. That is what silently broke inngest/scheduleTick.ts in
 * production: a schedule's `nextRunAt`, written by a process observing
 * one local zone, was read back by a process observing a different one
 * and came out shifted by exactly that zone's offset - a due export
 * looked like it was hours in the future and was never selected, with no
 * error anywhere (the query itself is correct; the values it compared
 * were not what they appeared to be).
 *
 * Pinning `process.env.TZ` here - before anything in this module (or
 * anything that imports it, which is every API route and every
 * inngest/*.ts file) constructs a client or runs a query - makes every
 * Date this process serializes or parses through `pg` agree with true
 * UTC, regardless of whatever timezone the underlying OS/container
 * happens to default to. This is a process-wide setting (not scoped to
 * this module), which is exactly the point: it has to be identical
 * across every process that ever touches this database, or the same
 * class of mismatch recurs the next time two of them disagree.
 * Confirmed safe: this codebase has exactly one local (non-UTC) Date
 * getter anywhere (`app/page.tsx`'s copyright-year footer), which this
 * only makes more correct, not less.
 */
process.env.TZ = 'UTC';

import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });

// Hot reload in dev otherwise opens a new pool on every save until Postgres refuses.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
