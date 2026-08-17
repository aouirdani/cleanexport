import { describe, it, expect, vi, beforeEach } from 'vitest';

// GET /api/runs/:id - specs/06-API-CONTRACT.md.

const { readSessionMock } = vi.hoisted(() => ({ readSessionMock: vi.fn() }));
vi.mock('@/lib/session', () => ({ readSession: readSessionMock }));

const { getRunMock } = vi.hoisted(() => ({ getRunMock: vi.fn() }));
vi.mock('@/lib/runs', () => ({ getRun: getRunMock }));

const { GET } = await import('@/app/api/runs/[id]/route');

const SESSION = { portalId: 'portal-1', hubspotPortalId: '1', userId: 'user-1', issuedAt: Date.now() };

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  readSessionMock.mockReset();
  getRunMock.mockReset();
});

describe('GET /api/runs/[id]', () => {
  it('401s when there is no session', async () => {
    readSessionMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/runs/run-1'), ctx('run-1'));

    expect(res.status).toBe(401);
    expect(getRunMock).not.toHaveBeenCalled();
  });

  it('404s for a run belonging to another portal (getRun itself is portal-scoped)', async () => {
    readSessionMock.mockResolvedValue(SESSION);
    getRunMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/runs/other-portals-run'), ctx('other-portals-run'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(getRunMock).toHaveBeenCalledWith('portal-1', 'other-portals-run');
  });

  it('returns the full run, including the complete errorMessage, when found', async () => {
    readSessionMock.mockResolvedValue(SESSION);
    const longMessage = 'This export took longer than 30 minutes. '.repeat(20);
    getRunMock.mockResolvedValue({ id: 'run-1', status: 'FAILED', errorCode: 'TIMEOUT', errorMessage: longMessage });

    const res = await GET(new Request('http://localhost/api/runs/run-1'), ctx('run-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.run.errorMessage).toBe(longMessage);
  });
});
