import { describe, it, expect, vi } from 'vitest';
import { fetchRecords, type Filters, type HubSpotRecord } from '@/lib/export/fetch';
import type { HubSpotClient } from '@/lib/hubspot/client';
import type { PropertyDef } from '@/lib/export/typeMap';
import { AppError, ErrorCode } from '@/lib/errors';

// Rules under test (specs/05-EXPORT-ENGINE.md sections 6 and 9;
// recon/FINDINGS.md sections 2, 3, 10, 13):
//
//   No filters -> GET listObjects, paging via paging.next.after, limit 100.
//   Filters present -> POST searchObjects, filters map to filterGroups[0].filters
//   (spec section 6). HubSpot search caps `total` at 10,000: reaching it means the
//   true result set may be larger and is unknowable from this response alone, so
//   fetchRecords must throw AppError(SEARCH_CAP_EXCEEDED) rather than silently
//   returning a truncated file - "the one failure mode that destroys trust
//   permanently" (spec section 6).
//
//   FINDINGS section 2: 200 short property names produced a 5,116-character query
//   string at HTTP 200, but verbose custom property names can exceed it. If the
//   assembled query string (properties + limit, the same params passed to
//   listObjects) would exceed ~7,000 characters, use searchObjects instead - a
//   POST body has no such limit - even when there are no filters at all.
//
//   FINDINGS section 13: a property with `currencyPropertyName` set must pull
//   that companion property in along with it, whether or not the caller asked for
//   it, or the currency is unknowable at write time. Deciding which requested
//   properties need a companion requires a property-definition lookup, and
//   fetchRecords's given signature does not carry one. THIS FILE'S DECISION:
//   fetchRecords gains a fifth, optional parameter,
//     propertyDefs?: Map<string, PropertyDef>
//   keyed by property name (the same PropertyDef already exported by
//   lib/export/typeMap.ts). Omitting it must not add anything or throw - not every
//   caller has property defs in hand.

function makeFakeClient(overrides: {
  listObjects?: ReturnType<typeof vi.fn>;
  searchObjects?: ReturnType<typeof vi.fn>;
}): HubSpotClient {
  return {
    listObjects: overrides.listObjects ?? vi.fn(),
    searchObjects: overrides.searchObjects ?? vi.fn(),
  } as unknown as HubSpotClient;
}

function record(id: string): HubSpotRecord {
  return { id, properties: {} } as HubSpotRecord;
}

async function collectPages(gen: AsyncGenerator<HubSpotRecord[]>): Promise<HubSpotRecord[][]> {
  const pages: HubSpotRecord[][] = [];
  for await (const page of gen) pages.push(page);
  return pages;
}

/** listObjects(objectType, params) - only params (the second argument) is ever inspected. */
function listObjectsReturning(byAfter: (params: Record<string, string>) => unknown) {
  return vi.fn().mockImplementation((...args: [string, Record<string, string>]) => byAfter(args[1]));
}

/** searchObjects(objectType, body) - only body (the second argument) is ever inspected. */
function searchObjectsReturning(byBody: (body: Record<string, unknown>) => unknown) {
  return vi.fn().mockImplementation((...args: [string, Record<string, unknown>]) => byBody(args[1]));
}

const SAMPLE_FILTERS: Filters = {
  operator: 'AND',
  conditions: [{ property: 'createdate', operator: 'BETWEEN', value: '2026-01-01', highValue: '2026-03-31' }],
};

describe('fetchRecords - no filters: listObjects, paginated via paging.next.after', () => {
  const page1 = { results: [record('1'), record('2')], paging: { next: { after: 'CURSOR_A' } } };
  const page2 = { results: [record('3')], paging: { next: { after: 'CURSOR_B' } } };
  const page3 = { results: [record('4')] }; // no paging.next -> last page

  function makeListObjects() {
    return listObjectsReturning((params) => {
      if (params.after === undefined) return page1;
      if (params.after === 'CURSOR_A') return page2;
      if (params.after === 'CURSOR_B') return page3;
      throw new Error('unexpected after cursor: ' + params.after);
    });
  }

  it('yields every page and forwards the after cursor returned by the previous page', async () => {
    const listObjects = makeListObjects();
    const client = makeFakeClient({ listObjects });

    const pages = await collectPages(fetchRecords(client, 'contacts', ['firstname']));

    expect(pages).toEqual([page1.results, page2.results, page3.results]);
    expect(listObjects).toHaveBeenCalledTimes(3);

    const calls = listObjects.mock.calls;
    expect(calls[0][0]).toBe('contacts');
    expect(calls[0][1].after).toBeUndefined();
    expect(calls[1][1].after).toBe('CURSOR_A'); // forwarded from page1.paging.next.after
    expect(calls[2][1].after).toBe('CURSOR_B'); // forwarded from page2.paging.next.after
  });

  it('requests up to 100 records per page and the exact requested properties', async () => {
    const listObjects = makeListObjects();
    const client = makeFakeClient({ listObjects });

    await collectPages(fetchRecords(client, 'contacts', ['firstname', 'lastname']));

    for (const [, params] of listObjects.mock.calls) {
      expect(params.limit).toBe('100');
      expect(params.properties).toBe('firstname,lastname');
    }
  });
});

describe('fetchRecords - with filters: searchObjects, filters map to filterGroups[0].filters', () => {
  it('uses searchObjects instead of listObjects, and paginates via after in the body', async () => {
    const searchPage1 = { results: [record('s1'), record('s2')], paging: { next: { after: 'S_CURSOR' } }, total: 3 };
    const searchPage2 = { results: [record('s3')], total: 3 };
    const searchObjects = searchObjectsReturning((body) => (body.after === undefined ? searchPage1 : searchPage2));
    const listObjects = vi.fn();
    const client = makeFakeClient({ listObjects, searchObjects });

    const pages = await collectPages(fetchRecords(client, 'contacts', ['firstname'], SAMPLE_FILTERS));

    expect(pages).toEqual([searchPage1.results, searchPage2.results]);
    expect(listObjects).not.toHaveBeenCalled();
    expect(searchObjects).toHaveBeenCalledTimes(2);

    const [, firstBody] = searchObjects.mock.calls[0];
    expect(firstBody.filterGroups).toEqual([{ filters: SAMPLE_FILTERS.conditions }]);
    expect(firstBody.properties).toEqual(['firstname']);

    const [, secondBody] = searchObjects.mock.calls[1];
    expect(secondBody.after).toBe('S_CURSOR'); // forwarded from searchPage1.paging.next.after
  });

  it.each([
    ["at HubSpot's reported cap of 10000", 10000, true],
    ['one below the cap', 9999, false],
  ])('total %s (%i) -> throws SEARCH_CAP_EXCEEDED: %s', async (_label, total, shouldThrow) => {
    const page = { results: [record('x')], total };
    const searchObjects = searchObjectsReturning(() => page);
    const client = makeFakeClient({ searchObjects, listObjects: vi.fn() });

    const promise = collectPages(fetchRecords(client, 'contacts', ['firstname'], SAMPLE_FILTERS));

    if (shouldThrow) {
      await expect(promise).rejects.toBeInstanceOf(AppError);
      await expect(
        collectPages(fetchRecords(client, 'contacts', ['firstname'], SAMPLE_FILTERS)),
      ).rejects.toMatchObject({ code: ErrorCode.SEARCH_CAP_EXCEEDED });
    } else {
      await expect(promise).resolves.toEqual([page.results]);
    }
  });

  it('never returns a partial result set silently when the cap is hit - it throws instead of stopping quietly', async () => {
    // A generator that just stopped (as if paging.next were absent) would look
    // identical to "that's all the data" to a caller - indistinguishable from a
    // correct, complete export. Throwing is the only way to make the failure visible.
    const cappedPage = { results: [record('x')], total: 10000 }; // no paging.next either
    const searchObjects = searchObjectsReturning(() => cappedPage);
    const client = makeFakeClient({ searchObjects, listObjects: vi.fn() });

    await expect(
      collectPages(fetchRecords(client, 'contacts', ['firstname'], SAMPLE_FILTERS)),
    ).rejects.toThrow(AppError);
  });
});

describe('fetchRecords - currencyPropertyName is pulled in even when not requested (FINDINGS.md section 13)', () => {
  const propertyDefsWithCurrency: Map<string, PropertyDef> = new Map([
    [
      'amount',
      {
        name: 'amount',
        label: 'Amount',
        type: 'number',
        fieldType: 'number',
        showCurrencySymbol: true,
        currencyPropertyName: 'deal_currency_code',
      },
    ],
  ]);

  it('adds the currency property to a listObjects (no-filter) request', async () => {
    const listObjects = listObjectsReturning(() => ({ results: [] }));
    const client = makeFakeClient({ listObjects });

    await collectPages(fetchRecords(client, 'deals', ['amount'], undefined, propertyDefsWithCurrency));

    const [, params] = listObjects.mock.calls[0];
    const requested = params.properties.split(',');
    expect(requested).toEqual(expect.arrayContaining(['amount', 'deal_currency_code']));
  });

  it('adds the currency property to a searchObjects (filtered) request too', async () => {
    const searchObjects = searchObjectsReturning(() => ({ results: [] }));
    const client = makeFakeClient({ searchObjects, listObjects: vi.fn() });

    await collectPages(fetchRecords(client, 'deals', ['amount'], SAMPLE_FILTERS, propertyDefsWithCurrency));

    const [, body] = searchObjects.mock.calls[0];
    expect(body.properties).toEqual(expect.arrayContaining(['amount', 'deal_currency_code']));
  });

  it('does not duplicate the currency property when the caller already requested it', async () => {
    const listObjects = listObjectsReturning(() => ({ results: [] }));
    const client = makeFakeClient({ listObjects });

    await collectPages(
      fetchRecords(client, 'deals', ['amount', 'deal_currency_code'], undefined, propertyDefsWithCurrency),
    );

    const [, params] = listObjects.mock.calls[0];
    const requested: string[] = params.properties.split(',');
    expect(requested.filter((p) => p === 'deal_currency_code')).toHaveLength(1);
  });

  it('without a propertyDefs argument, nothing extra is added and nothing throws', async () => {
    const listObjects = listObjectsReturning(() => ({ results: [] }));
    const client = makeFakeClient({ listObjects });

    await expect(collectPages(fetchRecords(client, 'deals', ['amount']))).resolves.toEqual([]);

    const [, params] = listObjects.mock.calls[0];
    expect(params.properties).toBe('amount');
  });
});

describe('fetchRecords - query string length fallback (FINDINGS.md section 2)', () => {
  const shortProperties = ['firstname', 'lastname', 'email'];
  // 200 verbose custom-property-style names, each far longer than anything in the
  // 5,116-character observation - comfortably over the ~7,000-character threshold
  // even before accounting for the limit param.
  const longProperties = Array.from(
    { length: 200 },
    (_unused, i) => `custom_property_with_a_fairly_long_internal_name_${String(i).padStart(3, '0')}`,
  );

  it('a short property list stays under the threshold and uses listObjects', async () => {
    const listObjects = listObjectsReturning(() => ({ results: [] }));
    const searchObjects = vi.fn();
    const client = makeFakeClient({ listObjects, searchObjects });

    await collectPages(fetchRecords(client, 'contacts', shortProperties));

    expect(listObjects).toHaveBeenCalledTimes(1);
    expect(searchObjects).not.toHaveBeenCalled();
  });

  it('a long property list exceeds the threshold and switches to searchObjects, even with no filters', async () => {
    const listObjects = vi.fn();
    const searchObjects = searchObjectsReturning(() => ({ results: [] }));
    const client = makeFakeClient({ listObjects, searchObjects });

    await collectPages(fetchRecords(client, 'contacts', longProperties));

    expect(listObjects).not.toHaveBeenCalled();
    expect(searchObjects).toHaveBeenCalledTimes(1);

    const [, body] = searchObjects.mock.calls[0];
    expect(body.properties).toEqual(longProperties);
    // No filters were given - the switch to search is purely about size, so no
    // filterGroups should be fabricated.
    expect(body.filterGroups ?? []).toEqual([]);
  });
});

describe('fetchRecords - an empty result set yields nothing and does not throw', () => {
  it('the generator is immediately done, with no yielded page, for an empty listObjects response', async () => {
    const listObjects = listObjectsReturning(() => ({ results: [] }));
    const client = makeFakeClient({ listObjects });

    const gen = fetchRecords(client, 'contacts', ['firstname']);
    const result = await gen.next();

    expect(result.done).toBe(true);
  });

  it('zero pages are yielded for an empty searchObjects response', async () => {
    const searchObjects = searchObjectsReturning(() => ({ results: [], total: 0 }));
    const client = makeFakeClient({ searchObjects, listObjects: vi.fn() });

    const pages = await collectPages(fetchRecords(client, 'contacts', ['firstname'], SAMPLE_FILTERS));
    expect(pages).toEqual([]);
  });
});

describe('fetchRecords - streams page by page, never accumulating the whole result set first', () => {
  it('a 3-page fake yields exactly 3 times, and each page is only fetched when pulled', async () => {
    const page1 = { results: [record('1')], paging: { next: { after: 'A' } } };
    const page2 = { results: [record('2')], paging: { next: { after: 'B' } } };
    const page3 = { results: [record('3')] };
    const listObjects = listObjectsReturning((params) => {
      if (params.after === undefined) return page1;
      if (params.after === 'A') return page2;
      if (params.after === 'B') return page3;
      throw new Error('unexpected after cursor: ' + params.after);
    });
    const client = makeFakeClient({ listObjects });

    const gen = fetchRecords(client, 'contacts', ['firstname']);

    // Nothing is fetched before the generator is pulled at all.
    expect(listObjects).not.toHaveBeenCalled();

    const r1 = await gen.next();
    expect(listObjects).toHaveBeenCalledTimes(1);
    expect(r1.done).toBe(false);
    expect(r1.value).toEqual(page1.results);

    // The second page is not fetched until it is actually pulled - proof this is
    // a real stream, not an array built up-front and handed out one slice at a time.
    const r2 = await gen.next();
    expect(listObjects).toHaveBeenCalledTimes(2);
    expect(r2.done).toBe(false);
    expect(r2.value).toEqual(page2.results);

    const r3 = await gen.next();
    expect(listObjects).toHaveBeenCalledTimes(3);
    expect(r3.done).toBe(false);
    expect(r3.value).toEqual(page3.results);

    const r4 = await gen.next();
    expect(r4.done).toBe(true);
    expect(listObjects).toHaveBeenCalledTimes(3); // no extra call once pages are exhausted
  });
});
