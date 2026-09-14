import { describe, it, expect, vi, beforeEach } from 'vitest';

// PATCH/DELETE /api/exports/:id - specs/06-API-CONTRACT.md. Closes the gap
// that a scheduled export could not be stopped or removed from the
// dashboard short of a database script.

const { readSessionMock } = vi.hoisted(() => ({ readSessionMock: vi.fn() }));
vi.mock('@/lib/session', () => ({ readSession: readSessionMock }));

const { findFirstExportMock, updateExportMock } = vi.hoisted(() => ({
  findFirstExportMock: vi.fn(),
  updateExportMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    exportDefinition: { findFirst: findFirstExportMock, update: updateExportMock },
  },
}));

const { nextCronOccurrenceMock } = vi.hoisted(() => ({ nextCronOccurrenceMock: vi.fn() }));
vi.mock('@/inngest/scheduleTick', () => ({ nextCronOccurrence: nextCronOccurrenceMock }));

const { PATCH, DELETE } = await import('@/app/api/exports/[id]/route');
const { AppError, ErrorCode } = await import('@/lib/errors');

const SESSION = { portalId: 'portal-1', hubspotPortalId: '1', userId: 'user-1', issuedAt: Date.now() };

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function patchReq(body: unknown) {
  return new Request('http://localhost/x', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  readSessionMock.mockReset();
  findFirstExportMock.mockReset();
  updateExportMock.mockReset();
  nextCronOccurrenceMock.mockReset();

  readSessionMock.mockResolvedValue(SESSION);
  findFirstExportMock.mockResolvedValue({
    id: 'export-1',
    isActive: true,
    scheduleCron: '0 9 * * *',
    scheduleTz: 'UTC',
  });
  updateExportMock.mockResolvedValue({ id: 'export-1', isActive: false, nextRunAt: null });
  nextCronOccurrenceMock.mockReturnValue(new Date('2026-09-16T09:00:00.000Z'));
});

describe('PATCH /api/exports/[id]', () => {
  it('401s when there is no session, without touching the DB', async () => {
    readSessionMock.mockResolvedValue(null);

    const res = await PATCH(patchReq({ isActive: false }), ctx('export-1'));

    expect(res.status).toBe(401);
    expect(findFirstExportMock).not.toHaveBeenCalled();
  });

  it('400s on an invalid body (missing isActive)', async () => {
    const res = await PATCH(patchReq({}), ctx('export-1'));
    expect(res.status).toBe(400);
    expect(findFirstExportMock).not.toHaveBeenCalled();
  });

  it('404s for an export id belonging to another portal - scoped in the query, not checked after', async () => {
    findFirstExportMock.mockResolvedValue(null);

    const res = await PATCH(patchReq({ isActive: false }), ctx('other-portals-export'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(findFirstExportMock).toHaveBeenCalledWith({
      where: { id: 'other-portals-export', portalId: 'portal-1', deletedAt: null },
      select: { id: true, isActive: true, scheduleCron: true, scheduleTz: true },
    });
    expect(updateExportMock).not.toHaveBeenCalled();
  });

  it('404s for an already soft-deleted export - a deleted row is not found, not merely inactive', async () => {
    // The fake findFirst mock doesn't evaluate `deletedAt: null` itself, but
    // the route always passes it in the WHERE - a real Prisma query against
    // a deletedAt-set row would return null, exactly like the "other
    // portal" case above. This test only re-confirms the null-handling
    // path; the WHERE clause assertion above is what proves deletedAt is
    // actually sent.
    findFirstExportMock.mockResolvedValue(null);

    const res = await PATCH(patchReq({ isActive: true }), ctx('deleted-export'));

    expect(res.status).toBe(404);
  });

  describe('pause: isActive true -> false', () => {
    it('sets isActive false and does NOT recompute nextRunAt', async () => {
      findFirstExportMock.mockResolvedValue({
        id: 'export-1',
        isActive: true,
        scheduleCron: '0 9 * * *',
        scheduleTz: 'UTC',
      });

      const res = await PATCH(patchReq({ isActive: false }), ctx('export-1'));

      expect(res.status).toBe(200);
      expect(nextCronOccurrenceMock).not.toHaveBeenCalled();
      expect(updateExportMock).toHaveBeenCalledWith({
        where: { id: 'export-1' },
        data: { isActive: false },
        select: { id: true, isActive: true, nextRunAt: true },
      });
    });

    it('this is what stops the schedule - export.schedule.tick\'s own query filters on isActive (see tests/inngest/scheduleTick.test.ts), no other field needs to change', async () => {
      findFirstExportMock.mockResolvedValue({
        id: 'export-1',
        isActive: true,
        scheduleCron: '*/15 * * * *',
        scheduleTz: 'UTC',
      });

      await PATCH(patchReq({ isActive: false }), ctx('export-1'));

      const call = updateExportMock.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(call.data).toEqual({ isActive: false }); // scheduleCron/nextRunAt untouched
    });
  });

  describe('resume: isActive false -> true', () => {
    it('recomputes nextRunAt from now when a scheduleCron is set - avoids an immediate catch-up run from a stale nextRunAt', async () => {
      findFirstExportMock.mockResolvedValue({
        id: 'export-1',
        isActive: false,
        scheduleCron: '0 9 * * *',
        scheduleTz: 'UTC',
      });
      const recomputed = new Date('2026-09-16T09:00:00.000Z');
      nextCronOccurrenceMock.mockReturnValue(recomputed);

      const res = await PATCH(patchReq({ isActive: true }), ctx('export-1'));

      expect(res.status).toBe(200);
      expect(nextCronOccurrenceMock).toHaveBeenCalledWith('0 9 * * *', 'UTC', expect.any(Date));
      expect(updateExportMock).toHaveBeenCalledWith({
        where: { id: 'export-1' },
        data: { isActive: true, nextRunAt: recomputed },
        select: { id: true, isActive: true, nextRunAt: true },
      });
    });

    it('does NOT recompute nextRunAt for a manual-only export (no scheduleCron)', async () => {
      findFirstExportMock.mockResolvedValue({ id: 'export-1', isActive: false, scheduleCron: null, scheduleTz: 'UTC' });

      await PATCH(patchReq({ isActive: true }), ctx('export-1'));

      expect(nextCronOccurrenceMock).not.toHaveBeenCalled();
      expect(updateExportMock).toHaveBeenCalledWith({
        where: { id: 'export-1' },
        data: { isActive: true },
        select: { id: true, isActive: true, nextRunAt: true },
      });
    });

    it('does NOT recompute nextRunAt when already active (isActive true -> true is a no-op resend, not a resume)', async () => {
      findFirstExportMock.mockResolvedValue({
        id: 'export-1',
        isActive: true,
        scheduleCron: '0 9 * * *',
        scheduleTz: 'UTC',
      });

      await PATCH(patchReq({ isActive: true }), ctx('export-1'));

      expect(nextCronOccurrenceMock).not.toHaveBeenCalled();
    });

    it('400s if the stored scheduleCron is somehow unparseable at resume time, rather than saving a schedule that can never be due', async () => {
      findFirstExportMock.mockResolvedValue({
        id: 'export-1',
        isActive: false,
        scheduleCron: 'garbage',
        scheduleTz: 'UTC',
      });
      nextCronOccurrenceMock.mockImplementation(() => {
        throw new Error('Malformed cron expression: "garbage"');
      });

      const res = await PATCH(patchReq({ isActive: true }), ctx('export-1'));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(updateExportMock).not.toHaveBeenCalled();
    });
  });

  it('returns the updated export shape', async () => {
    updateExportMock.mockResolvedValue({ id: 'export-1', isActive: false, nextRunAt: null });

    const res = await PATCH(patchReq({ isActive: false }), ctx('export-1'));
    const body = await res.json();

    expect(body).toEqual({ export: { id: 'export-1', isActive: false, nextRunAt: null } });
  });
});

describe('DELETE /api/exports/[id]', () => {
  it('401s when there is no session, without touching the DB', async () => {
    readSessionMock.mockResolvedValue(null);

    const res = await DELETE(new Request('http://localhost/x'), ctx('export-1'));

    expect(res.status).toBe(401);
    expect(findFirstExportMock).not.toHaveBeenCalled();
  });

  it('404s for an export id belonging to another portal', async () => {
    findFirstExportMock.mockResolvedValue(null);

    const res = await DELETE(new Request('http://localhost/x'), ctx('other-portals-export'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(findFirstExportMock).toHaveBeenCalledWith({
      where: { id: 'other-portals-export', portalId: 'portal-1', deletedAt: null },
      select: { id: true, isActive: true, scheduleCron: true, scheduleTz: true },
    });
    expect(updateExportMock).not.toHaveBeenCalled();
  });

  it('soft-deletes: sets isActive false AND deletedAt, in one update - this is what "cancels the schedule" per specs/06-API-CONTRACT.md', async () => {
    const before = new Date();
    const res = await DELETE(new Request('http://localhost/x'), ctx('export-1'));
    const after = new Date();

    expect(res.status).toBe(200);
    expect(updateExportMock).toHaveBeenCalledTimes(1);
    const call = updateExportMock.mock.calls[0][0] as { where: { id: string }; data: { isActive: boolean; deletedAt: Date } };
    expect(call.where).toEqual({ id: 'export-1' });
    expect(call.data.isActive).toBe(false);
    expect(call.data.deletedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(call.data.deletedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('returns { success: true }', async () => {
    const res = await DELETE(new Request('http://localhost/x'), ctx('export-1'));
    const body = await res.json();
    expect(body).toEqual({ success: true });
  });
});
