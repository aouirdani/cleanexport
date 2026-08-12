import { describe, it, expect, vi } from 'vitest';
import { resolveAssociations } from '@/lib/export/associations';
import type { HubSpotClient } from '@/lib/hubspot/client';

// Rules under test (specs/05-EXPORT-ENGINE.md section 7; recon/FINDINGS.md
// sections 11 and 12 - ground truth from a real portal, wins over anything
// remembered about the HubSpot API in general):
//
//   Resolution is TWO batched calls, not one:
//     1. POST .../associations/{from}/{to}/batch/read - ids only, up to 100
//        inputs per call. HTTP 207 is a SUCCESS (multi-status): some inputs
//        resolved, some did not. Records with no association are ABSENT from
//        `results` and listed in `errors` instead - never zip results with
//        inputs by index. Build a Map keyed by String(from.id); a missing id
//        means an empty cell, not a failed run (FINDINGS section 11).
//     2. POST .../{toObjectType}/batch/read - fetches spec.columns for the
//        resolved ids.
//
//   Trap A (section 11): 207 must not be treated as an error, and the
//   `errors` array must actually be read (context.fromObjectId identifies
//   the failed record), not merely ignored.
//
//   Trap B (section 12): from.id arrives as a STRING, to[].toObjectId as a
//   NUMBER, in the same response. String() both sides of every key
//   operation, or the lookup silently misses and every association column
//   comes out empty with no error.
//
//   Trap C (section 12): the primary associated record is the `to[]` entry
//   whose associationTypes contains one labelled "Primary" (typeId 5 for
//   deal->company) - NOT to[0]. Array order is not documented as stable.
//   Fall back to to[0] only when nothing is labelled.
//
// cardinality: 'JOIN' (spec section 7: "ship only if a customer asks") is
// out of scope for this file - every test below omits `cardinality`, i.e.
// exercises the MVP default, PRIMARY.

function makeFakeClient(overrides: {
  batchReadAssociations?: ReturnType<typeof vi.fn>;
  batchReadObjects?: ReturnType<typeof vi.fn>;
}): HubSpotClient {
  return {
    batchReadAssociations: overrides.batchReadAssociations ?? vi.fn(),
    batchReadObjects: overrides.batchReadObjects ?? vi.fn(),
  } as unknown as HubSpotClient;
}

interface AssociationType {
  category: string;
  typeId: number;
  label: string | null;
}

interface AssociationResult {
  from: { id: string };
  to: Array<{ toObjectId: number; associationTypes: AssociationType[] }>;
}

interface AssociationError {
  status: string;
  category: string;
  subCategory?: string;
  message: string;
  context: { fromObjectId: string[]; fromObjectType?: string[]; toObjectType?: string[] };
}

interface AssociationsResponse {
  status?: string;
  results: AssociationResult[];
  errors?: AssociationError[];
  numErrors?: number;
}

interface ObjectsResponse {
  status?: string;
  results: Array<{ id: string; properties: Record<string, unknown> }>;
  errors?: unknown[];
  numErrors?: number;
}

/** batchReadAssociations(from, to, inputs) - only inputs (the third argument) is ever inspected. */
function associationsMock(byInputs: (inputs: { id: string }[]) => AssociationsResponse) {
  return vi.fn().mockImplementation((...args: [string, string, { id: string }[]]) => byInputs(args[2]));
}

/** batchReadObjects(objectType, body) - only body (the second argument) is ever inspected. */
function objectsMock(byBody: (body: { inputs: { id: string }[]; properties: string[] }) => ObjectsResponse) {
  return vi
    .fn()
    .mockImplementation((...args: [string, { inputs: { id: string }[]; properties: string[] }]) => byBody(args[1]));
}

const PRIMARY_TYPE: AssociationType = { category: 'HUBSPOT_DEFINED', typeId: 5, label: 'Primary' };
const UNLABELLED_TYPE: AssociationType = { category: 'HUBSPOT_DEFINED', typeId: 341, label: null };

describe('resolveAssociations - resolution is two batched calls, not one', () => {
  it('calls batchReadAssociations for ids, then batchReadObjects for the requested columns', async () => {
    const batchReadAssociations = associationsMock((inputs) => ({
      status: 'COMPLETE',
      results: inputs.map((input) => ({
        from: { id: input.id },
        to: [{ toObjectId: 442222359747, associationTypes: [PRIMARY_TYPE] }],
      })),
      errors: [],
      numErrors: 0,
    }));
    const batchReadObjects = objectsMock((body) => ({
      status: 'COMPLETE',
      results: body.inputs.map((input) => ({ id: input.id, properties: { name: 'Acme Corp', domain: 'acme.com' } })),
      errors: [],
      numErrors: 0,
    }));
    const client = makeFakeClient({ batchReadAssociations, batchReadObjects });

    const map = await resolveAssociations(client, 'deals', ['515690208449'], {
      toObjectType: 'companies',
      columns: ['name', 'domain'],
    });

    expect(batchReadAssociations).toHaveBeenCalledTimes(1);
    const [fromType, toType, assocInputs] = batchReadAssociations.mock.calls[0];
    expect(fromType).toBe('deals');
    expect(toType).toBe('companies');
    expect(assocInputs).toEqual([{ id: '515690208449' }]);

    // Step 1 returns ids only - the actual column values must come from step 2.
    expect(batchReadObjects).toHaveBeenCalledTimes(1);
    const [objType, objBody] = batchReadObjects.mock.calls[0];
    expect(objType).toBe('companies');
    expect(objBody.properties).toEqual(['name', 'domain']);
    expect(objBody.inputs).toEqual([{ id: '442222359747' }]);

    expect(map.get('515690208449')).toEqual({ name: 'Acme Corp', domain: 'acme.com' });
  });
});

describe('resolveAssociations - trap A: HTTP 207 is a success, errors are parsed not ignored', () => {
  it('a single record with no association: 207, empty results, one error entry -> empty map, no crash', async () => {
    // The exact shape from FINDINGS.md section 11.
    const batchReadAssociations = associationsMock(() => ({
      status: 'COMPLETE',
      results: [],
      errors: [
        {
          status: 'error',
          category: 'OBJECT_NOT_FOUND',
          subCategory: 'crm.associations.NO_ASSOCIATIONS_FOUND',
          message: 'No company is associated with deal 515690208449.',
          context: { fromObjectId: ['515690208449'], fromObjectType: ['deal'], toObjectType: ['company'] },
        },
      ],
      numErrors: 1,
    }));
    const batchReadObjects = vi.fn();
    const client = makeFakeClient({ batchReadAssociations, batchReadObjects });

    const map = await resolveAssociations(client, 'deals', ['515690208449'], {
      toObjectType: 'companies',
      columns: ['name'],
    });

    expect(map.has('515690208449')).toBe(false); // missing key = empty cell, not a thrown error
    expect(map.size).toBe(0);
    // Nothing resolved, so there is nothing to fetch columns for.
    expect(batchReadObjects).not.toHaveBeenCalled();
  });

  it('a mixed batch (one resolved, one errored) attributes the failure via context.fromObjectId and keeps the resolved record intact', async () => {
    const batchReadAssociations = associationsMock(() => ({
      status: 'COMPLETE',
      // Deliberately NOT the same order/length as the two requested ids -
      // proves results is not zipped against inputs by index.
      results: [{ from: { id: 'deal-resolved' }, to: [{ toObjectId: 999888777, associationTypes: [PRIMARY_TYPE] }] }],
      errors: [
        {
          status: 'error',
          category: 'OBJECT_NOT_FOUND',
          subCategory: 'crm.associations.NO_ASSOCIATIONS_FOUND',
          message: 'No company is associated with deal deal-unassociated.',
          context: { fromObjectId: ['deal-unassociated'], fromObjectType: ['deal'], toObjectType: ['company'] },
        },
      ],
      numErrors: 1,
    }));
    const batchReadObjects = objectsMock((body) => ({
      status: 'COMPLETE',
      results: body.inputs.map((input) => ({ id: input.id, properties: { name: 'Resolved Co' } })),
      errors: [],
      numErrors: 0,
    }));
    const client = makeFakeClient({ batchReadAssociations, batchReadObjects });

    const map = await resolveAssociations(client, 'deals', ['deal-resolved', 'deal-unassociated'], {
      toObjectType: 'companies',
      columns: ['name'],
    });

    expect(map.get('deal-resolved')).toEqual({ name: 'Resolved Co' });
    expect(map.has('deal-unassociated')).toBe(false);
    expect(map.size).toBe(1);

    // Only the resolved company was ever worth fetching columns for.
    const [, objBody] = batchReadObjects.mock.calls[0];
    expect(objBody.inputs).toEqual([{ id: '999888777' }]);
  });
});

describe('resolveAssociations - trap B: from.id is a string, toObjectId is a number', () => {
  it('resolves correctly even though from.id (string) and toObjectId (number) are different JS types in the same payload', async () => {
    const batchReadAssociations = associationsMock(() => ({
      status: 'COMPLETE',
      results: [
        {
          from: { id: '515690208449' }, // string, exactly as FINDINGS section 12 observed
          to: [{ toObjectId: 442222359747, associationTypes: [PRIMARY_TYPE] }], // number
        },
      ],
      errors: [],
      numErrors: 0,
    }));
    const batchReadObjects = objectsMock((body) => ({
      status: 'COMPLETE',
      // batch/read on objects returns id as a STRING, matching the id it was requested with.
      results: body.inputs.map((input) => ({ id: input.id, properties: { name: 'Acme Corp' } })),
      errors: [],
      numErrors: 0,
    }));
    const client = makeFakeClient({ batchReadAssociations, batchReadObjects });

    const map = await resolveAssociations(client, 'deals', ['515690208449'], {
      toObjectType: 'companies',
      columns: ['name'],
    });

    // A Map keyed by one type and read with the other fails silently (empty
    // result, no exception) - so the strong assertion here is the POSITIVE case.
    expect(map.get('515690208449')).toEqual({ name: 'Acme Corp' });

    const [, objBody] = batchReadObjects.mock.calls[0];
    expect(objBody.inputs).toEqual([{ id: '442222359747' }]); // String(442222359747), not the number
  });

  it('a 16-digit toObjectId round-trips through String() with no precision loss or reformatting', async () => {
    const bigId = 1234567890123456; // 16 digits
    const batchReadAssociations = associationsMock(() => ({
      status: 'COMPLETE',
      results: [{ from: { id: 'deal-1' }, to: [{ toObjectId: bigId, associationTypes: [PRIMARY_TYPE] }] }],
      errors: [],
      numErrors: 0,
    }));
    const batchReadObjects = objectsMock((body) => ({
      status: 'COMPLETE',
      results: body.inputs.map((input) => ({ id: input.id, properties: { name: 'Big Co' } })),
      errors: [],
      numErrors: 0,
    }));
    const client = makeFakeClient({ batchReadAssociations, batchReadObjects });

    await resolveAssociations(client, 'deals', ['deal-1'], { toObjectType: 'companies', columns: ['name'] });

    const [, objBody] = batchReadObjects.mock.calls[0];
    // Exact decimal string - no scientific notation, no truncation, no rounding.
    expect(objBody.inputs).toEqual([{ id: '1234567890123456' }]);
  });
});

describe('resolveAssociations - trap C: the primary associated record is not to[0]', () => {
  it('matches the real observed payload where the primary happens to be first (FINDINGS.md section 12)', async () => {
    const batchReadAssociations = associationsMock(() => ({
      status: 'COMPLETE',
      results: [
        {
          from: { id: '515690208449' },
          to: [
            { toObjectId: 442222359747, associationTypes: [UNLABELLED_TYPE, PRIMARY_TYPE] },
            { toObjectId: 442488735948, associationTypes: [UNLABELLED_TYPE] },
          ],
        },
      ],
      errors: [],
      numErrors: 0,
    }));
    const batchReadObjects = objectsMock((body) => ({
      status: 'COMPLETE',
      results: body.inputs.map((input) => ({
        id: input.id,
        properties: { name: input.id === '442222359747' ? 'Primary Co' : 'Secondary Co' },
      })),
      errors: [],
      numErrors: 0,
    }));
    const client = makeFakeClient({ batchReadAssociations, batchReadObjects });

    const map = await resolveAssociations(client, 'deals', ['515690208449'], {
      toObjectType: 'companies',
      columns: ['name'],
    });

    expect(map.get('515690208449')).toEqual({ name: 'Primary Co' });
  });

  it('picks the labelled Primary entry even when it is NOT to[0] - this is exactly how the to[0] bug survives testing', async () => {
    const batchReadAssociations = associationsMock(() => ({
      status: 'COMPLETE',
      results: [
        {
          from: { id: 'deal-2' },
          to: [
            // to[0] is NOT primary - a naive `to[0]` implementation would pick this one.
            { toObjectId: 111111111111, associationTypes: [UNLABELLED_TYPE] },
            // the actually-primary company is second.
            { toObjectId: 222222222222, associationTypes: [UNLABELLED_TYPE, PRIMARY_TYPE] },
          ],
        },
      ],
      errors: [],
      numErrors: 0,
    }));
    const batchReadObjects = objectsMock((body) => ({
      status: 'COMPLETE',
      results: body.inputs.map((input) => ({
        id: input.id,
        properties: { name: input.id === '222222222222' ? 'Actually Primary' : 'Not Primary' },
      })),
      errors: [],
      numErrors: 0,
    }));
    const client = makeFakeClient({ batchReadAssociations, batchReadObjects });

    const map = await resolveAssociations(client, 'deals', ['deal-2'], {
      toObjectType: 'companies',
      columns: ['name'],
    });

    expect(map.get('deal-2')).toEqual({ name: 'Actually Primary' });

    const [, objBody] = batchReadObjects.mock.calls[0];
    expect(objBody.inputs).toEqual([{ id: '222222222222' }]);
  });

  it('falls back to to[0] only when nothing is labelled Primary', async () => {
    const batchReadAssociations = associationsMock(() => ({
      status: 'COMPLETE',
      results: [
        {
          from: { id: 'deal-3' },
          to: [
            { toObjectId: 333333333333, associationTypes: [UNLABELLED_TYPE] },
            { toObjectId: 444444444444, associationTypes: [UNLABELLED_TYPE] },
          ],
        },
      ],
      errors: [],
      numErrors: 0,
    }));
    const batchReadObjects = objectsMock((body) => ({
      status: 'COMPLETE',
      results: body.inputs.map((input) => ({ id: input.id, properties: { name: 'Whichever' } })),
      errors: [],
      numErrors: 0,
    }));
    const client = makeFakeClient({ batchReadAssociations, batchReadObjects });

    await resolveAssociations(client, 'deals', ['deal-3'], { toObjectType: 'companies', columns: ['name'] });

    const [, objBody] = batchReadObjects.mock.calls[0];
    expect(objBody.inputs).toEqual([{ id: '333333333333' }]); // to[0], the only defensible fallback
  });
});

describe('resolveAssociations - batching: up to 100 ids per call, never one call per record', () => {
  it('150 record ids are split into two associations calls and two objects calls, each covering the full set exactly once', async () => {
    const RECORD_COUNT = 150;
    const recordIds = Array.from({ length: RECORD_COUNT }, (_unused, i) => `deal-${i}`);
    const companyIdFor = (i: number) => 500000 + i;

    const batchReadAssociations = associationsMock((inputs) => ({
      status: 'COMPLETE',
      results: inputs.map((input) => {
        const i = Number(input.id.replace('deal-', ''));
        return { from: { id: input.id }, to: [{ toObjectId: companyIdFor(i), associationTypes: [PRIMARY_TYPE] }] };
      }),
      errors: [],
      numErrors: 0,
    }));
    const batchReadObjects = objectsMock((body) => ({
      status: 'COMPLETE',
      results: body.inputs.map((input) => ({ id: input.id, properties: { name: `Company ${input.id}` } })),
      errors: [],
      numErrors: 0,
    }));
    const client = makeFakeClient({ batchReadAssociations, batchReadObjects });

    const map = await resolveAssociations(client, 'deals', recordIds, { toObjectType: 'companies', columns: ['name'] });

    expect(batchReadAssociations).toHaveBeenCalledTimes(2);
    const assocCallSizes = batchReadAssociations.mock.calls.map(([, , inputs]) => inputs.length);
    expect(assocCallSizes).toEqual([100, 50]);
    for (const size of assocCallSizes) expect(size).toBeLessThanOrEqual(100);

    const requestedDealIds = batchReadAssociations.mock.calls.flatMap(([, , inputs]) =>
      inputs.map((i: { id: string }) => i.id),
    );
    expect(new Set(requestedDealIds).size).toBe(RECORD_COUNT); // no duplicates
    expect(requestedDealIds.sort()).toEqual([...recordIds].sort()); // full coverage

    expect(batchReadObjects).toHaveBeenCalledTimes(2);
    const objectCallSizes = batchReadObjects.mock.calls.map(([, body]) => body.inputs.length);
    for (const size of objectCallSizes) expect(size).toBeLessThanOrEqual(100);
    expect(objectCallSizes.reduce((a, b) => a + b, 0)).toBe(RECORD_COUNT);

    const requestedCompanyIds = batchReadObjects.mock.calls.flatMap(([, body]) =>
      body.inputs.map((i: { id: string }) => i.id),
    );
    expect(new Set(requestedCompanyIds).size).toBe(RECORD_COUNT); // no duplicate company fetches

    expect(map.size).toBe(RECORD_COUNT);
    expect(map.get('deal-0')).toEqual({ name: `Company ${String(companyIdFor(0))}` });
    expect(map.get('deal-149')).toEqual({ name: `Company ${String(companyIdFor(149))}` });
  });
});

describe('resolveAssociations - an empty recordIds array makes no calls at all', () => {
  it('returns an empty map without calling either endpoint', async () => {
    const batchReadAssociations = vi.fn();
    const batchReadObjects = vi.fn();
    const client = makeFakeClient({ batchReadAssociations, batchReadObjects });

    const map = await resolveAssociations(client, 'deals', [], { toObjectType: 'companies', columns: ['name'] });

    expect(map.size).toBe(0);
    expect(batchReadAssociations).not.toHaveBeenCalled();
    expect(batchReadObjects).not.toHaveBeenCalled();
  });
});
