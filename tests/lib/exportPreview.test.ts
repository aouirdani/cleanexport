import { describe, it, expect, vi, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HubSpotClient } from '@/lib/hubspot/client';
import type { PropertyDef } from '@/lib/export/typeMap';
import type { HubSpotRecord } from '@/lib/export/fetch';
import { writeExport } from '@/lib/export/writer';
import {
  runPreview,
  columnValueType,
  classifyPreviewError,
  PREVIEW_ROW_LIMIT,
  type PreviewCellValue,
} from '@/lib/exportPreview';
import { AppError, ErrorCode } from '@/lib/errors';

// lib/exportPreview.ts - specs/07-TASKS.md T18. The central claim under
// test: "It must use the SAME pipeline as a real export ... otherwise the
// preview lies" - verified directly by running BOTH runPreview() and the
// real writeExport() over the identical records/PropertyDefs and comparing
// cell-for-cell, not by re-deriving expectations by hand.

function makeFakeClient(overrides: {
  listObjects?: ReturnType<typeof vi.fn>;
  searchObjects?: ReturnType<typeof vi.fn>;
  batchReadAssociations?: ReturnType<typeof vi.fn>;
  batchReadObjects?: ReturnType<typeof vi.fn>;
}): HubSpotClient {
  return {
    listObjects: overrides.listObjects ?? vi.fn(),
    searchObjects: overrides.searchObjects ?? vi.fn(),
    batchReadAssociations: overrides.batchReadAssociations ?? vi.fn(),
    batchReadObjects: overrides.batchReadObjects ?? vi.fn(),
  } as unknown as HubSpotClient;
}

function record(id: string, properties: Record<string, string | null>): HubSpotRecord {
  return { id, properties };
}

const FIRSTNAME_DEF: PropertyDef = { name: 'firstname', label: 'First Name', type: 'string', fieldType: 'text' };
const NOTES_DEF: PropertyDef = { name: 'notes_last_contacted', label: 'Notes', type: 'string', fieldType: 'textarea' };
const AMOUNT_DEF: PropertyDef = { name: 'amount', label: 'Amount', type: 'number', fieldType: 'number' };
const CURRENCY_AMOUNT_DEF: PropertyDef = {
  name: 'amount',
  label: 'Amount',
  type: 'number',
  fieldType: 'number',
  showCurrencySymbol: true,
  currencyPropertyName: 'deal_currency_code',
};
const CLOSEDATE_DEF: PropertyDef = { name: 'closedate', label: 'Close Date', type: 'date', fieldType: 'date' };
const CREATEDATE_DEF: PropertyDef = { name: 'createdate', label: 'Create Date', type: 'datetime', fieldType: 'date' };
const CHECKED_DEF: PropertyDef = { name: 'is_active', label: 'Active', type: 'bool', fieldType: 'booleancheckbox' };
const STATUS_DEF: PropertyDef = {
  name: 'lead_status',
  label: 'Lead Status',
  type: 'enumeration',
  fieldType: 'select',
  options: [{ value: 'NEW', label: 'New' }, { value: 'OPEN', label: 'Open' }],
};
const OWNER_DEF: PropertyDef = {
  name: 'hubspot_owner_id',
  label: 'Owner',
  type: 'enumeration',
  fieldType: 'select',
  referencedObjectType: 'OWNER',
};
const ASSOC_ID_DEF: PropertyDef = {
  name: 'associatedcompanyid',
  label: 'Associated Company',
  type: 'number',
  fieldType: 'number',
  referencedObjectType: 'COMPANY',
};

describe('columnValueType - specs/05-EXPORT-ENGINE.md sections 4.0 and 4, restated as data', () => {
  it('a referencedObjectType property is always text, even OWNER', () => {
    expect(columnValueType(OWNER_DEF)).toBe('text');
    expect(columnValueType(ASSOC_ID_DEF)).toBe('text');
  });

  it('number -> number', () => {
    expect(columnValueType(AMOUNT_DEF)).toBe('number');
  });

  it('datetime -> datetime, date -> date (distinct - a datetime keeps its time-of-day)', () => {
    expect(columnValueType(CREATEDATE_DEF)).toBe('datetime');
    expect(columnValueType(CLOSEDATE_DEF)).toBe('date');
  });

  it('bool -> boolean', () => {
    expect(columnValueType(CHECKED_DEF)).toBe('boolean');
  });

  it('enumeration/select -> text (label text, not a real type)', () => {
    expect(columnValueType(STATUS_DEF)).toBe('text');
  });

  it('enumeration/booleancheckbox -> boolean', () => {
    const def: PropertyDef = { name: 'x', label: 'X', type: 'enumeration', fieldType: 'booleancheckbox' };
    expect(columnValueType(def)).toBe('boolean');
  });

  it('string and unmapped types -> text', () => {
    expect(columnValueType(FIRSTNAME_DEF)).toBe('text');
    expect(columnValueType({ name: 'x', label: 'X', type: 'object_coordinates', fieldType: 'text' })).toBe('text');
    expect(columnValueType({ name: 'x', label: 'X', type: 'something_new', fieldType: 'text' })).toBe('text');
  });

  it('an unknown (skipped) property is text', () => {
    expect(columnValueType(undefined)).toBe('text');
  });
});

describe('classifyPreviewError - plain language for the customer-facing failure modes', () => {
  it('TOKEN_REVOKED tells the user to reconnect', () => {
    const result = classifyPreviewError(new AppError(ErrorCode.TOKEN_REVOKED, 'grant revoked', 401));
    expect(result.status).toBe(401);
    expect(result.message).toMatch(/reconnect/i);
  });

  it('SEARCH_CAP_EXCEEDED tells the user to narrow the filter', () => {
    const result = classifyPreviewError(new AppError(ErrorCode.SEARCH_CAP_EXCEEDED, 'cap hit', 400));
    expect(result.message).toMatch(/narrower filter/i);
  });

  it('RATE_LIMITED tells the user to wait', () => {
    const result = classifyPreviewError(new AppError(ErrorCode.RATE_LIMITED, '429', 429));
    expect(result.message).toMatch(/wait/i);
  });

  it('a generic HUBSPOT_ERROR (e.g. a bad filter) tells the user to check their filters, never the raw HubSpot body', () => {
    const result = classifyPreviewError(
      new AppError(ErrorCode.HUBSPOT_ERROR, 'HubSpot returned 400: {"category":"VALIDATION_ERROR","message":"..."}', 400),
    );
    expect(result.message).toMatch(/filters/i);
    expect(result.message).not.toContain('VALIDATION_ERROR');
  });

  it('a non-AppError is a generic 500 with no leaked internals', () => {
    const result = classifyPreviewError(new TypeError("Cannot read properties of undefined (reading 'foo')"));
    expect(result.status).toBe(500);
    expect(result.message).not.toContain('Cannot read properties');
  });
});

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeAndReadBack(
  records: HubSpotRecord[],
  properties: string[],
  propertyDefs: Map<string, PropertyDef>,
  headerStyle: 'LABEL' | 'INTERNAL' | 'BOTH' = 'LABEL',
  owners?: Map<string, { name: string; email: string }>,
): Promise<unknown[][]> {
  const dir = await mkdtemp(join(tmpdir(), 'preview-parity-'));
  tempDirs.push(dir);
  const filePath = join(dir, 'out.xlsx');

  await writeExport({
    filePath,
    records: (async function* () {
      yield records;
    })(),
    properties,
    propertyDefs,
    headerStyle,
    owners,
  });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet('Export')!;
  const dataStartRow = headerStyle === 'BOTH' ? 3 : 2;

  const rows: unknown[][] = [];
  for (let r = 0; r < records.length; r++) {
    const row = sheet.getRow(dataStartRow + r);
    rows.push(properties.map((_p, i) => row.getCell(i + 1).value));
  }
  return rows;
}

function toComparable(excelValue: unknown): PreviewCellValue {
  if (excelValue instanceof Date) return excelValue.toISOString();
  if (excelValue === undefined) return null;
  if (typeof excelValue === 'string' || typeof excelValue === 'number' || typeof excelValue === 'boolean') {
    return excelValue;
  }
  return null;
}

describe('runPreview vs. writeExport - identical values for identical input', () => {
  it('every mapped/sanitized cell value matches the real export, across every type in the dispatch table', async () => {
    const properties = [
      'firstname',
      'notes_last_contacted',
      'amount',
      'closedate',
      'createdate',
      'is_active',
      'lead_status',
      'hubspot_owner_id',
      'associatedcompanyid',
    ];
    const propertyDefs = new Map<string, PropertyDef>([
      ['firstname', FIRSTNAME_DEF],
      ['notes_last_contacted', NOTES_DEF],
      ['amount', AMOUNT_DEF],
      ['closedate', CLOSEDATE_DEF],
      ['createdate', CREATEDATE_DEF],
      ['is_active', CHECKED_DEF],
      ['lead_status', STATUS_DEF],
      ['hubspot_owner_id', OWNER_DEF],
      ['associatedcompanyid', ASSOC_ID_DEF],
    ]);
    const owners = new Map([['42', { name: 'Ada Lovelace', email: 'ada@example.com' }]]);

    const records = [
      record('1', {
        firstname: '=SUM(1,1)', // formula-injection defence must still trigger
        notes_last_contacted: 'Line one\r\nLine two\rLine three', // CRLF/CR normalisation
        amount: '1234.56',
        closedate: '2026-03-15',
        createdate: '2026-03-15T10:30:00Z',
        is_active: 'true',
        lead_status: 'NEW',
        hubspot_owner_id: '42',
        associatedcompanyid: '442222359747',
      }),
      record('2', {
        firstname: null,
        notes_last_contacted: null,
        amount: 'not-a-number',
        closedate: 'not-a-date',
        createdate: null,
        is_active: 'false',
        lead_status: 'UNKNOWN_VALUE',
        hubspot_owner_id: '999-no-such-owner',
        associatedcompanyid: null,
      }),
    ];

    const expectedRows = await writeAndReadBack(records, properties, propertyDefs, 'LABEL', owners);

    const client = makeFakeClient({ listObjects: vi.fn().mockResolvedValue({ results: records }) });
    const result = await runPreview({
      client,
      propertyDefs,
      owners,
      definition: { objectType: 'CONTACTS', properties, headerStyle: 'LABEL' },
    });

    expect(result.sampleRows).toHaveLength(2);
    for (let r = 0; r < records.length; r++) {
      for (let c = 0; c < properties.length; c++) {
        expect(result.sampleRows[r][c]).toEqual(toComparable(expectedRows[r][c]));
      }
    }
  });

  it('a currency property (showCurrencySymbol) matches too', async () => {
    const properties = ['amount'];
    const propertyDefs = new Map<string, PropertyDef>([['amount', CURRENCY_AMOUNT_DEF]]);
    const records = [record('1', { amount: '99.5', deal_currency_code: 'EUR' })];

    const expectedRows = await writeAndReadBack(records, properties, propertyDefs);

    const client = makeFakeClient({ listObjects: vi.fn().mockResolvedValue({ results: records }) });
    const result = await runPreview({
      client,
      propertyDefs,
      definition: { objectType: 'DEALS', properties, headerStyle: 'LABEL' },
    });

    expect(result.sampleRows[0][0]).toEqual(toComparable(expectedRows[0][0]));
    expect(result.columns[0].type).toBe('number');
  });
});

describe('runPreview - "take the first page and stop"', () => {
  it('never requests a second page even when one is available', async () => {
    const listObjects = vi.fn().mockResolvedValue({
      results: [record('1', { firstname: 'Ada' })],
      paging: { next: { after: 'CURSOR_A' } },
    });
    const client = makeFakeClient({ listObjects });
    const propertyDefs = new Map([['firstname', FIRSTNAME_DEF]]);

    await runPreview({
      client,
      propertyDefs,
      definition: { objectType: 'CONTACTS', properties: ['firstname'], headerStyle: 'LABEL' },
    });

    expect(listObjects).toHaveBeenCalledTimes(1);
  });

  it('caps sampleRows at PREVIEW_ROW_LIMIT (20) even when the first page has more', async () => {
    const records = Array.from({ length: 100 }, (_, i) => record(String(i), { firstname: `Person ${i}` }));
    const client = makeFakeClient({ listObjects: vi.fn().mockResolvedValue({ results: records }) });
    const propertyDefs = new Map([['firstname', FIRSTNAME_DEF]]);

    const result = await runPreview({
      client,
      propertyDefs,
      definition: { objectType: 'CONTACTS', properties: ['firstname'], headerStyle: 'LABEL' },
    });

    expect(result.sampleRows).toHaveLength(PREVIEW_ROW_LIMIT);
    expect(result.sampleRows[0][0]).toBe('Person 0');
    expect(result.sampleRows[19][0]).toBe('Person 19');
  });

  it('zero matching records: columns are still returned, sampleRows is empty (never an error)', async () => {
    const client = makeFakeClient({ listObjects: vi.fn().mockResolvedValue({ results: [] }) });
    const propertyDefs = new Map([['firstname', FIRSTNAME_DEF]]);

    const result = await runPreview({
      client,
      propertyDefs,
      definition: { objectType: 'CONTACTS', properties: ['firstname'], headerStyle: 'LABEL' },
    });

    expect(result.sampleRows).toEqual([]);
    expect(result.columns).toEqual([{ key: 'firstname', header: 'First Name', type: 'text' }]);
  });
});

describe('runPreview - column order and header style', () => {
  it('preserves the properties array order exactly, never sorted', async () => {
    const properties = ['lead_status', 'firstname', 'amount'];
    const propertyDefs = new Map<string, PropertyDef>([
      ['firstname', FIRSTNAME_DEF],
      ['amount', AMOUNT_DEF],
      ['lead_status', STATUS_DEF],
    ]);
    const client = makeFakeClient({ listObjects: vi.fn().mockResolvedValue({ results: [] }) });

    const result = await runPreview({
      client,
      propertyDefs,
      definition: { objectType: 'CONTACTS', properties, headerStyle: 'LABEL' },
    });

    expect(result.columns.map((c) => c.key)).toEqual(['lead_status', 'firstname', 'amount']);
  });

  it('skips a property no longer in the portal - specs/05-EXPORT-ENGINE.md section 8, same as a real run', async () => {
    const propertyDefs = new Map<string, PropertyDef>([['firstname', FIRSTNAME_DEF]]);
    const client = makeFakeClient({ listObjects: vi.fn().mockResolvedValue({ results: [record('1', { firstname: 'Ada' })] }) });

    const result = await runPreview({
      client,
      propertyDefs,
      definition: { objectType: 'CONTACTS', properties: ['firstname', 'deleted_property'], headerStyle: 'LABEL' },
    });

    expect(result.columns.map((c) => c.key)).toEqual(['firstname']);
    expect(result.sampleRows[0]).toEqual(['Ada']);
  });

  it('LABEL uses the property label as the header', async () => {
    const propertyDefs = new Map([['firstname', FIRSTNAME_DEF]]);
    const client = makeFakeClient({ listObjects: vi.fn().mockResolvedValue({ results: [] }) });
    const result = await runPreview({ client, propertyDefs, definition: { objectType: 'CONTACTS', properties: ['firstname'], headerStyle: 'LABEL' } });
    expect(result.columns[0].header).toBe('First Name');
  });

  it('INTERNAL uses the internal property name as the header', async () => {
    const propertyDefs = new Map([['firstname', FIRSTNAME_DEF]]);
    const client = makeFakeClient({ listObjects: vi.fn().mockResolvedValue({ results: [] }) });
    const result = await runPreview({ client, propertyDefs, definition: { objectType: 'CONTACTS', properties: ['firstname'], headerStyle: 'INTERNAL' } });
    expect(result.columns[0].header).toBe('firstname');
  });

  it('BOTH carries both pieces of information in one header, since the preview has one header row', async () => {
    const propertyDefs = new Map([['firstname', FIRSTNAME_DEF]]);
    const client = makeFakeClient({ listObjects: vi.fn().mockResolvedValue({ results: [] }) });
    const result = await runPreview({ client, propertyDefs, definition: { objectType: 'CONTACTS', properties: ['firstname'], headerStyle: 'BOTH' } });
    expect(result.columns[0].header).toBe('First Name (firstname)');
  });
});

describe('runPreview - associations (specs/05-EXPORT-ENGINE.md section 7)', () => {
  it('appends association columns after the primary columns, prefixed by the object name, always text', async () => {
    const propertyDefs = new Map([['firstname', FIRSTNAME_DEF]]);
    const client = makeFakeClient({
      listObjects: vi.fn().mockResolvedValue({ results: [record('1', { firstname: 'Ada' })] }),
      batchReadAssociations: vi.fn().mockResolvedValue({
        results: [{ from: { id: '1' }, to: [{ toObjectId: 55, associationTypes: [{ typeId: 5, label: 'Primary' }] }] }],
      }),
      batchReadObjects: vi.fn().mockResolvedValue({ results: [{ id: '55', properties: { name: 'Acme Inc', domain: 'acme.com' } }] }),
    });

    const result = await runPreview({
      client,
      propertyDefs,
      definition: {
        objectType: 'DEALS',
        properties: ['firstname'],
        headerStyle: 'LABEL',
        associations: { toObjectType: 'COMPANIES', columns: ['name', 'domain'] },
      },
    });

    expect(result.columns.map((c) => c.header)).toEqual(['First Name', 'Company · Name', 'Company · Domain']);
    expect(result.columns.slice(1).every((c) => c.type === 'text')).toBe(true);
    expect(result.sampleRows[0]).toEqual(['Ada', 'Acme Inc', 'acme.com']);
  });

  it('a record with no association gets an empty cell, not a missing row', async () => {
    const propertyDefs = new Map([['firstname', FIRSTNAME_DEF]]);
    const client = makeFakeClient({
      listObjects: vi.fn().mockResolvedValue({ results: [record('1', { firstname: 'Ada' })] }),
      batchReadAssociations: vi.fn().mockResolvedValue({ results: [] }),
      batchReadObjects: vi.fn().mockResolvedValue({ results: [] }),
    });

    const result = await runPreview({
      client,
      propertyDefs,
      definition: {
        objectType: 'DEALS',
        properties: ['firstname'],
        headerStyle: 'LABEL',
        associations: { toObjectType: 'COMPANIES', columns: ['name'] },
      },
    });

    expect(result.sampleRows[0]).toEqual(['Ada', null]);
  });
});
