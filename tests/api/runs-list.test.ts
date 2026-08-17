import { describe, it, expect, vi, beforeEach } from 'vitest';

// GET /api/runs - specs/06-API-CONTRACT.md. portalId always from the
// session; lib/runs.ts is mocked so this test only exercises the route's
// own request-parsing/auth/response-shaping, not the DB query logic
// (covered separately in tests/lib/runs.test.ts).

const { readSessionMock } = vi.hoisted(() => ({ readSessionMock: vi.fn() }));
vi.mock('@/lib/session', () => ({ readSession: readSessionMock }));

const { listRunsMock } = vi.hoisted(() => ({ listRunsMock: vi.fn() }));
vi.mock('@/lib/runs', () => ({ listRuns: listRunsMock }));

const { GET } = await import('@/app/api/runs/route');

const SESSION = { portalId: 'portal-1', hubspotPortalId: '1', userId: 'user-1', issuedAt: Date.now() };

beforeEach(() => {
  readSessionMock.mockReset();
  listRunsMock.mockReset();
  listRunsMock.mockResolvedValue([]);
});

describe('GET /api/runs', () => {
  it('401s when there is no session, without querying', async () => {
    readSessionMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/runs'));

    expect(res.status).toBe(401);
    expect(listRunsMock).not.toHaveBeenCalled();
  });

  it('passes the session\'s portalId, never anything from the request, to listRuns', async () => {
    readSessionMock.mockResolvedValue(SESSION);

    await GET(new Request('http://localhost/api/runs?exportId=export-1&portalId=someone-elses-portal'));

    expect(listRunsMock).toHaveBeenCalledWith('portal-1', { exportId: 'export-1', limit: undefined });
  });

  it('forwards a numeric limit query param', async () => {
    readSessionMock.mockResolvedValue(SESSION);

    await GET(new Request('http://localhost/api/runs?limit=5'));

    expect(listRunsMock).toHaveBeenCalledWith('portal-1', { exportId: undefined, limit: 5 });
  });

  it('returns the runs under a "runs" key', async () => {
    readSessionMock.mockResolvedValue(SESSION);
    listRunsMock.mockResolvedValue([{ id: 'run-1', errorMessage: null }]);

    const res = await GET(new Request('http://localhost/api/runs'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.runs).toEqual([{ id: 'run-1', errorMessage: null }]);
  });

  it('never truncates a long errorMessage on the way through the response', async () => {
    readSessionMock.mockResolvedValue(SESSION);
    const longMessage = 'a'.repeat(3000);
    listRunsMock.mockResolvedValue([{ id: 'run-1', status: 'FAILED', errorMessage: longMessage }]);

    const res = await GET(new Request('http://localhost/api/runs'));
    const body = await res.json();

    expect(body.runs[0].errorMessage).toHaveLength(3000);
  });
});
