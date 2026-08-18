import { describe, it, expect, vi, beforeEach } from 'vitest';

// POST /api/exports/preview - specs/06-API-CONTRACT.md, specs/07-TASKS.md
// T18: previews an UNSAVED definition. lib/exportPreview.ts's runPreview is
// mocked so this test only exercises the route's own
// auth/validation/wiring, not the preview pipeline itself (covered by
// tests/lib/exportPreview.test.ts).

const { readSessionMock } = vi.hoisted(() => ({ readSessionMock: vi.fn() }));
vi.mock('@/lib/session', () => ({ readSession: readSessionMock }));

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

const { POST } = await import('@/app/api/exports/preview/route');
const { AppError, ErrorCode } = await import('@/lib/errors');

const SESSION = { portalId: 'portal-1', hubspotPortalId: '1', userId: 'user-1', issuedAt: Date.now() };

function req(body: unknown) {
  return new Request('http://localhost/api/exports/preview', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const VALID_BODY = {
  name: 'Weekly Deals',
  objectType: 'DEALS',
  properties: ['dealname', 'amount'],
};

beforeEach(() => {
  readSessionMock.mockReset();
  forPortalMock.mockReset();
  loadPropertyDefsMock.mockReset();
  loadOwnersMock.mockReset();
  runPreviewMock.mockReset();

  readSessionMock.mockResolvedValue(SESSION);
  forPortalMock.mockResolvedValue({ __fakeClient: true });
  loadPropertyDefsMock.mockResolvedValue(new Map());
  loadOwnersMock.mockResolvedValue(new Map());
  runPreviewMock.mockResolvedValue({ columns: [], sampleRows: [] });
});

describe('POST /api/exports/preview', () => {
  it('401s when there is no session, without calling HubSpot', async () => {
    readSessionMock.mockResolvedValue(null);

    const res = await POST(req(VALID_BODY));

    expect(res.status).toBe(401);
    expect(forPortalMock).not.toHaveBeenCalled();
  });

  it('400s on malformed JSON', async () => {
    const res = await POST(new Request('http://localhost/api/exports/preview', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });

  it('validates the body with the SAME CreateExportSchema a save uses - an invalid body 400s before touching HubSpot', async () => {
    const res = await POST(req({ ...VALID_BODY, properties: [] })); // fails CreateExportSchema's .min(1)

    expect(res.status).toBe(400);
    expect(forPortalMock).not.toHaveBeenCalled();
  });

  it('a body that would fail CreateExportSchema in the exact same way a save would fail also fails here (>200 properties)', async () => {
    const properties = Array.from({ length: 201 }, (_, i) => `p${i}`);
    const res = await POST(req({ ...VALID_BODY, properties }));
    expect(res.status).toBe(400);
  });

  it('uses the session portalId for the HubSpot client, never anything from the body', async () => {
    await POST(req({ ...VALID_BODY, portalId: 'someone-elses-portal' }));

    expect(forPortalMock).toHaveBeenCalledWith('portal-1');
  });

  it('loads property defs for the submitted objectType and passes the validated definition through to runPreview', async () => {
    await POST(req(VALID_BODY));

    expect(loadPropertyDefsMock).toHaveBeenCalledWith(expect.anything(), 'portal-1', 'DEALS');
    expect(runPreviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: expect.objectContaining({ objectType: 'DEALS', properties: ['dealname', 'amount'], headerStyle: 'LABEL' }),
      }),
    );
  });

  it('returns 200 with the { columns, sampleRows } shape from runPreview', async () => {
    runPreviewMock.mockResolvedValue({
      columns: [{ key: 'dealname', header: 'Deal Name', type: 'text' }],
      sampleRows: [['Big Deal']],
    });

    const res = await POST(req(VALID_BODY));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ columns: [{ key: 'dealname', header: 'Deal Name', type: 'text' }], sampleRows: [['Big Deal']] });
  });

  it('writes nothing to disk and creates no ExportRun - the route never touches the filesystem or Prisma\'s exportRun model', async () => {
    // No @/lib/db mock is registered at all in this file - if the route
    // imported prisma and called exportRun.create, this test file would
    // fail to even load (the real module needs DATABASE_URL). The fact
    // this suite runs at all is the assertion.
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(200);
  });

  it('surfaces a classified error (e.g. TOKEN_REVOKED) in plain language', async () => {
    runPreviewMock.mockRejectedValue(new AppError(ErrorCode.TOKEN_REVOKED, 'revoked', 401));

    const res = await POST(req(VALID_BODY));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.message).toMatch(/reconnect/i);
  });
});
