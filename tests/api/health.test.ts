import { describe, it, expect, vi, beforeEach } from 'vitest';

// GET /api/health - specs/07-TASKS.md T22: "{ ok, db, version }... must NOT
// leak configuration: no environment variable names, no connection
// strings, no versions of anything except the app itself."

const { queryRawMock } = vi.hoisted(() => ({ queryRawMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { $queryRaw: queryRawMock } }));

const { GET } = await import('@/app/api/health/route');
const packageJson = await import('@/package.json');

beforeEach(() => {
  queryRawMock.mockReset();
});

describe('GET /api/health', () => {
  it('200s with { ok: true, db: "ok" } when the DB check succeeds', async () => {
    queryRawMock.mockResolvedValue([{ '?column?': 1 }]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, db: 'ok', version: packageJson.version });
  });

  it('503s with { ok: false, db: "error" } when the DB check fails, without leaking the error', async () => {
    queryRawMock.mockRejectedValue(
      new Error('connection to server at "db.internal.example.com" (10.0.0.5), port 5432 failed: password authentication failed for user "cleanexport"'),
    );

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({ ok: false, db: 'error', version: packageJson.version });
  });

  it('the response contains no environment variable names, connection strings, or dependency versions', async () => {
    queryRawMock.mockResolvedValue([{ '?column?': 1 }]);

    const res = await GET();
    const text = await res.text();

    for (const forbidden of [
      'DATABASE_URL',
      'postgresql://',
      'postgres://',
      'ENCRYPTION_KEY',
      'SESSION_SECRET',
      'STRIPE_SECRET_KEY',
      'node', // no Node.js version field
      'next', // no Next.js version field
      'prisma', // no Prisma version field
    ]) {
      expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('the response body has exactly the three documented keys, nothing extra', async () => {
    queryRawMock.mockResolvedValue([{ '?column?': 1 }]);

    const res = await GET();
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(['db', 'ok', 'version']);
  });

  it('version is this app\'s own package.json version, not any dependency\'s', async () => {
    queryRawMock.mockResolvedValue([{ '?column?': 1 }]);

    const res = await GET();
    const body = await res.json();

    expect(body.version).toBe(packageJson.version);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
