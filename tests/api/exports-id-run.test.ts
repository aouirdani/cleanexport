import { describe, it, expect, vi, beforeEach } from 'vitest';

// POST /api/exports/:id/run - specs/06-API-CONTRACT.md, the manual "Run
// now" trigger. assertWithinPlan and Inngest are mocked so this test only
// exercises the route's own scoping/idempotency/dispatch wiring.

const { readSessionMock } = vi.hoisted(() => ({ readSessionMock: vi.fn() }));
vi.mock('@/lib/session', () => ({ readSession: readSessionMock }));

const { findFirstExportMock, findFirstRunMock, createRunMock } = vi.hoisted(() => ({
  findFirstExportMock: vi.fn(),
  findFirstRunMock: vi.fn(),
  createRunMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    exportDefinition: { findFirst: findFirstExportMock },
    exportRun: { findFirst: findFirstRunMock, create: createRunMock },
  },
}));

const { assertWithinPlanMock } = vi.hoisted(() => ({ assertWithinPlanMock: vi.fn() }));
vi.mock('@/lib/plan', () => ({ assertWithinPlan: assertWithinPlanMock }));

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock('@/inngest/client', () => ({ inngest: { send: sendMock } }));

const { POST } = await import('@/app/api/exports/[id]/run/route');
const { AppError, ErrorCode } = await import('@/lib/errors');

const SESSION = { portalId: 'portal-1', hubspotPortalId: '1', userId: 'user-1', issuedAt: Date.now() };

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  readSessionMock.mockReset();
  findFirstExportMock.mockReset();
  findFirstRunMock.mockReset();
  createRunMock.mockReset();
  assertWithinPlanMock.mockReset();
  sendMock.mockReset();

  readSessionMock.mockResolvedValue(SESSION);
  findFirstExportMock.mockResolvedValue({ id: 'export-1' });
  findFirstRunMock.mockResolvedValue(null); // no run currently in flight
  createRunMock.mockResolvedValue({ id: 'run-1' });
  assertWithinPlanMock.mockResolvedValue(undefined);
  sendMock.mockResolvedValue(undefined);
});

describe('POST /api/exports/[id]/run', () => {
  it('401s when there is no session, without touching the DB', async () => {
    readSessionMock.mockResolvedValue(null);

    const res = await POST(new Request('http://localhost/x'), ctx('export-1'));

    expect(res.status).toBe(401);
    expect(findFirstExportMock).not.toHaveBeenCalled();
  });

  it('404s for an export id belonging to another portal - scoped in the query, not checked after', async () => {
    findFirstExportMock.mockResolvedValue(null);

    const res = await POST(new Request('http://localhost/x'), ctx('other-portals-export'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(findFirstExportMock).toHaveBeenCalledWith({
      where: { id: 'other-portals-export', portalId: 'portal-1' },
      select: { id: true },
    });
    expect(createRunMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('creates a QUEUED, MANUAL ExportRun scoped to the session\'s portal', async () => {
    await POST(new Request('http://localhost/x'), ctx('export-1'));

    expect(createRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { portalId: 'portal-1', exportId: 'export-1', status: 'QUEUED', trigger: 'MANUAL' },
      }),
    );
  });

  it('emits export.run.requested exactly once with the created run\'s id', async () => {
    createRunMock.mockResolvedValue({ id: 'run-abc' });

    await POST(new Request('http://localhost/x'), ctx('export-1'));

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith({ name: 'export.run.requested', data: { exportRunId: 'run-abc' } });
  });

  it('returns 202 { runId }', async () => {
    createRunMock.mockResolvedValue({ id: 'run-abc' });

    const res = await POST(new Request('http://localhost/x'), ctx('export-1'));
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body).toEqual({ runId: 'run-abc' });
  });

  describe('plan limit - RUN_EXPORT', () => {
    it('enforces assertWithinPlan(portalId, "RUN_EXPORT") before creating a run', async () => {
      await POST(new Request('http://localhost/x'), ctx('export-1'));
      expect(assertWithinPlanMock).toHaveBeenCalledWith('portal-1', 'RUN_EXPORT');
    });

    it('at the boundary: when assertWithinPlan refuses, no run is created and no event is sent', async () => {
      assertWithinPlanMock.mockRejectedValue(
        new AppError(ErrorCode.PLAN_LIMIT_REACHED, "You've used all 20 of today's export runs. This limit resets at Jan 2, 12:00 AM UTC.", 403),
      );

      const res = await POST(new Request('http://localhost/x'), ctx('export-1'));
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.error.code).toBe('PLAN_LIMIT_REACHED');
      // Names the limit and the reset time, not a generic error.
      expect(body.error.message).toContain('20');
      expect(body.error.message).toMatch(/resets at/i);
      expect(createRunMock).not.toHaveBeenCalled();
      expect(sendMock).not.toHaveBeenCalled();
    });

    it('below the boundary: assertWithinPlan resolving lets the run proceed', async () => {
      const res = await POST(new Request('http://localhost/x'), ctx('export-1'));
      expect(res.status).toBe(202);
      expect(createRunMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('duplicate click does not create two runs', () => {
    it('when a run for this export is already QUEUED, returns that run\'s id and creates nothing new', async () => {
      findFirstRunMock.mockResolvedValue({ id: 'already-queued-run' });

      const res = await POST(new Request('http://localhost/x'), ctx('export-1'));
      const body = await res.json();

      expect(res.status).toBe(202);
      expect(body).toEqual({ runId: 'already-queued-run' });
      expect(createRunMock).not.toHaveBeenCalled();
      expect(sendMock).not.toHaveBeenCalled();
      expect(assertWithinPlanMock).not.toHaveBeenCalled(); // no new run attempted, no limit consumed
    });

    it('when a run for this export is already RUNNING, same short-circuit', async () => {
      findFirstRunMock.mockResolvedValue({ id: 'already-running-run' });

      const res = await POST(new Request('http://localhost/x'), ctx('export-1'));
      const body = await res.json();

      expect(res.status).toBe(202);
      expect(body.runId).toBe('already-running-run');
      expect(createRunMock).not.toHaveBeenCalled();
    });

    it('checks in-flight status scoped to this export only', async () => {
      await POST(new Request('http://localhost/x'), ctx('export-1'));

      expect(findFirstRunMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { exportId: 'export-1', status: { in: ['QUEUED', 'RUNNING'] } } }),
      );
    });

    it('two sequential requests: the first creates a run, the second (now finding it QUEUED) reuses it', async () => {
      createRunMock.mockResolvedValue({ id: 'run-1' });

      // First call: nothing in flight yet.
      findFirstRunMock.mockResolvedValueOnce(null);
      const res1 = await POST(new Request('http://localhost/x'), ctx('export-1'));
      const body1 = await res1.json();

      // Second call: the run created above is now QUEUED.
      findFirstRunMock.mockResolvedValueOnce({ id: 'run-1' });
      const res2 = await POST(new Request('http://localhost/x'), ctx('export-1'));
      const body2 = await res2.json();

      expect(body1.runId).toBe('run-1');
      expect(body2.runId).toBe('run-1');
      expect(createRunMock).toHaveBeenCalledTimes(1);
      expect(sendMock).toHaveBeenCalledTimes(1);
    });

    it('a SUCCESS or FAILED (terminal) previous run does not block a new one', async () => {
      findFirstRunMock.mockResolvedValue(null); // findFirst's own where clause excludes terminal statuses - simulated here by returning null

      const res = await POST(new Request('http://localhost/x'), ctx('export-1'));

      expect(res.status).toBe(202);
      expect(createRunMock).toHaveBeenCalledTimes(1);
    });
  });
});
