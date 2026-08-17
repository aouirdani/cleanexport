import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RunStatus } from '@/lib/generated/prisma/client';

// app/api/runs/[id]/download/route.ts - specs/07-TASKS.md T14. No live
// session/DB/R2: @/lib/session and @/lib/db are mocked at the module level,
// and @/inngest/r2 is mocked so the signed URL returned is a predictable,
// inspectable string rather than a real presign.

const { readSessionMock } = vi.hoisted(() => ({ readSessionMock: vi.fn() }));
vi.mock('@/lib/session', () => ({ readSession: readSessionMock }));

const { findFirstMock } = vi.hoisted(() => ({ findFirstMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { exportRun: { findFirst: findFirstMock } } }));

const { signedDownloadUrlMock } = vi.hoisted(() => ({
  signedDownloadUrlMock: vi.fn(() => 'https://example.r2.cloudflarestorage.com/bucket/exports/portal-1/secret-token.xlsx?X-Amz-Signature=deadbeef'),
}));
vi.mock('@/inngest/r2', () => ({
  loadR2Config: () => ({ accountId: 'a', accessKeyId: 'b', secretAccessKey: 'c', bucket: 'd' }),
  signedDownloadUrl: signedDownloadUrlMock,
  DOWNLOAD_URL_TTL_SECONDS: 7 * 24 * 60 * 60,
}));

const { GET } = await import('@/app/api/runs/[id]/download/route');

const SESSION = { portalId: 'portal-1', hubspotPortalId: '1', userId: 'user-1', issuedAt: Date.now() };

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  readSessionMock.mockReset();
  findFirstMock.mockReset();
  signedDownloadUrlMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/runs/[id]/download', () => {
  it('401s when there is no session', async () => {
    readSessionMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/runs/run-1/download'), ctx('run-1'));

    expect(res.status).toBe(401);
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('302s to a freshly-generated signed URL for a successful run belonging to the caller\'s portal', async () => {
    readSessionMock.mockResolvedValue(SESSION);
    findFirstMock.mockResolvedValue({
      status: RunStatus.SUCCESS,
      fileKey: 'exports/portal-1/secret-token.xlsx',
      finishedAt: new Date(Date.now() - 60_000), // one minute ago, well inside the window
    });

    const res = await GET(new Request('http://localhost/api/runs/run-1/download'), ctx('run-1'));

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('secret-token.xlsx');
    // Scoped by portalId in the query itself, not checked after an unscoped lookup.
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { id: 'run-1', portalId: 'portal-1' },
      select: { status: true, fileKey: true, finishedAt: true },
    });
    // Generated fresh on this request - never read back from a stored column.
    expect(signedDownloadUrlMock).toHaveBeenCalledTimes(1);
  });

  it('returns 404, not 403, for a run id that belongs to another portal - indistinguishable from a run that does not exist', async () => {
    readSessionMock.mockResolvedValue(SESSION);
    // The fake DB itself never returns a cross-portal row - this is exactly
    // what `findFirst({ where: { id, portalId } })` guarantees: a row that
    // exists but belongs to another portal simply doesn't match the query.
    findFirstMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/runs/other-portals-run/download'), ctx('other-portals-run'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for a run id that genuinely does not exist - same response shape as the cross-portal case', async () => {
    readSessionMock.mockResolvedValue(SESSION);
    findFirstMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/runs/does-not-exist/download'), ctx('does-not-exist'));

    expect(res.status).toBe(404);
  });

  it('returns 404 for a run that has not succeeded (no file to download)', async () => {
    readSessionMock.mockResolvedValue(SESSION);
    findFirstMock.mockResolvedValue({ status: RunStatus.FAILED, fileKey: null, finishedAt: null });

    const res = await GET(new Request('http://localhost/api/runs/run-1/download'), ctx('run-1'));

    expect(res.status).toBe(404);
    expect(signedDownloadUrlMock).not.toHaveBeenCalled();
  });

  it('returns 410 once the 7-day download window has passed, even though the run succeeded', async () => {
    readSessionMock.mockResolvedValue(SESSION);
    findFirstMock.mockResolvedValue({
      status: RunStatus.SUCCESS,
      fileKey: 'exports/portal-1/secret-token.xlsx',
      finishedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 days ago
    });

    const res = await GET(new Request('http://localhost/api/runs/run-1/download'), ctx('run-1'));
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(body.error.code).toBe('LINK_EXPIRED');
    expect(signedDownloadUrlMock).not.toHaveBeenCalled();
  });

  it('is still downloadable one second before the 7-day window elapses (boundary)', async () => {
    readSessionMock.mockResolvedValue(SESSION);
    findFirstMock.mockResolvedValue({
      status: RunStatus.SUCCESS,
      fileKey: 'exports/portal-1/secret-token.xlsx',
      finishedAt: new Date(Date.now() - (7 * 24 * 60 * 60 * 1000 - 1000)),
    });

    const res = await GET(new Request('http://localhost/api/runs/run-1/download'), ctx('run-1'));

    expect(res.status).toBe(302);
  });

  it('never logs the signed URL, object key, or any token-like query param', async () => {
    readSessionMock.mockResolvedValue(SESSION);
    findFirstMock.mockResolvedValue({
      status: RunStatus.SUCCESS,
      fileKey: 'exports/portal-1/secret-token.xlsx',
      finishedAt: new Date(Date.now() - 60_000),
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await GET(new Request('http://localhost/api/runs/run-1/download'), ctx('run-1'));

    for (const spy of [logSpy, errorSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        const joined = call.map((a) => String(a)).join(' ');
        expect(joined).not.toContain('secret-token');
        expect(joined).not.toContain('X-Amz-Signature');
        expect(joined).not.toContain('exports/portal-1');
      }
    }
  });
});
