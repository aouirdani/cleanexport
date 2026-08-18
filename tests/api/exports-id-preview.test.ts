import { describe, it, expect, vi, beforeEach } from 'vitest';

// POST /api/exports/:id/preview - specs/06-API-CONTRACT.md, specs/07-TASKS.md T18.

const { readSessionMock } = vi.hoisted(() => ({ readSessionMock: vi.fn() }));
vi.mock('@/lib/session', () => ({ readSession: readSessionMock }));

const { findFirstMock } = vi.hoisted(() => ({ findFirstMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { exportDefinition: { findFirst: findFirstMock } } }));

const { forPortalMock } = vi.hoisted(() => ({ forPortalMock: vi.fn() }));
vi.mock('@/lib/hubspot/client', () => ({ HubSpotClient: { forPortal: forPortalMock } }));

const { loadPropertyDefsMock, loadOwnersMock } = vi.hoisted(() => ({
  loadPropertyDefsMock: vi.fn(),
  loadOwnersMock: vi.fn(),
}));
vi.mock('@/inngest/propertyDefs', () => ({ loadPropertyDefs: loadPropertyDefsMock, loadOwners: loadOwnersMock }));

const { runPreviewMock } = vi.hoisted(() => ({ runPreviewMock: vi.fn() }));
vi.mock('@/lib/exportPreview', async () => {
  const actual = await vi.importActual<typeof import('@/lib/exportPreview')>('@/lib/exportPreview');
  return { ...actual, runPreview: runPreviewMock };
});

const { POST } = await import('@/app/api/exports/[id]/preview/route');
const { AppError, ErrorCode } = await import('@/lib/errors');

const SESSION = { portalId: 'portal-1', hubspotPortalId: '1', userId: 'user-1', issuedAt: Date.now() };

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const SAVED_EXPORT = {
  id: 'export-1',
  portalId: 'portal-1',
  objectType: 'DEALS',
  properties: ['dealname', 'amount'],
  headerStyle: 'LABEL',
  filters: null,
  associations: null,
};

beforeEach(() => {
  readSessionMock.mockReset();
  findFirstMock.mockReset();
  forPortalMock.mockReset();
  loadPropertyDefsMock.mockReset();
  loadOwnersMock.mockReset();
  runPreviewMock.mockReset();

  readSessionMock.mockResolvedValue(SESSION);
  findFirstMock.mockResolvedValue(SAVED_EXPORT);
  forPortalMock.mockResolvedValue({ __fakeClient: true });
  loadPropertyDefsMock.mockResolvedValue(new Map());
  loadOwnersMock.mockResolvedValue(new Map());
  runPreviewMock.mockResolvedValue({ columns: [], sampleRows: [] });
});

describe('POST /api/exports/[id]/preview', () => {
  it('401s when there is no session', async () => {
    readSessionMock.mockResolvedValue(null);

    const res = await POST(new Request('http://localhost/x'), ctx('export-1'));

    expect(res.status).toBe(401);
    expect(findFirstMock).not.toHaveBeenCalled();
  });

  it('404s for an export id belonging to another portal - scoped in the query, not checked after', async () => {
    findFirstMock.mockResolvedValue(null);

    const res = await POST(new Request('http://localhost/x'), ctx('other-portals-export'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(findFirstMock).toHaveBeenCalledWith({ where: { id: 'other-portals-export', portalId: 'portal-1' } });
  });

  it('loads the saved definition and passes it through to runPreview', async () => {
    await POST(new Request('http://localhost/x'), ctx('export-1'));

    expect(runPreviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: expect.objectContaining({
          objectType: 'DEALS',
          properties: ['dealname', 'amount'],
          headerStyle: 'LABEL',
        }),
      }),
    );
  });

  it('passes stored filters/associations through when present', async () => {
    findFirstMock.mockResolvedValue({
      ...SAVED_EXPORT,
      filters: { operator: 'AND', conditions: [{ property: 'amount', operator: 'GT', value: '1000' }] },
      associations: { toObjectType: 'COMPANIES', columns: ['name'], cardinality: 'PRIMARY' },
    });

    await POST(new Request('http://localhost/x'), ctx('export-1'));

    const call = runPreviewMock.mock.calls[0][0] as { definition: { filters: unknown; associations: unknown } };
    expect(call.definition.filters).toEqual({ operator: 'AND', conditions: [{ property: 'amount', operator: 'GT', value: '1000' }] });
    expect(call.definition.associations).toEqual({ toObjectType: 'COMPANIES', columns: ['name'], cardinality: 'PRIMARY' });
  });

  it('returns 200 with the { columns, sampleRows } shape', async () => {
    runPreviewMock.mockResolvedValue({ columns: [{ key: 'dealname', header: 'Deal Name', type: 'text' }], sampleRows: [] });

    const res = await POST(new Request('http://localhost/x'), ctx('export-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.columns).toEqual([{ key: 'dealname', header: 'Deal Name', type: 'text' }]);
    expect(body.sampleRows).toEqual([]);
  });

  it('surfaces a classified error in plain language', async () => {
    runPreviewMock.mockRejectedValue(new AppError(ErrorCode.SEARCH_CAP_EXCEEDED, 'cap', 400));

    const res = await POST(new Request('http://localhost/x'), ctx('export-1'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.message).toMatch(/narrower filter/i);
  });
});
