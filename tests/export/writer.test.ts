import { describe, it, expect, afterEach } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeExport } from '@/lib/export/writer';
import type { HubSpotRecord } from '@/lib/export/fetch';
import type { PropertyDef } from '@/lib/export/typeMap';

// Rules under test (specs/05-EXPORT-ENGINE.md sections 1, 2, 5, 7, 10;
// recon/FINDINGS.md sections 9, 10; lib/export/sanitize.ts, lib/export/typeMap.ts):
//
//   Contract (section 1), the five invariants:
//     1. one record -> exactly one row, regardless of content
//     2. columns follow `properties` order exactly, never sorted
//     3. dates are Excel dates, numbers are Excel numbers, text is text
//     4. no cell contains null, undefined, NaN, or [object Object]
//     5. the file opens without a repair prompt
//
//   FINDINGS section 10: HubSpot always returns createdate, hs_object_id and
//   lastmodifieddate whether or not they were requested. The writer must
//   iterate `properties` (the user's ordered array), never
//   Object.keys(record.properties) - the latter would add unrequested
//   columns and destroy the configured order.
//
//   FINDINGS section 9: a bare `\n` inside a property value is legal in an
//   XLSX cell. Preserve it and set wrapText - the record stays one row.
//
//   Section 5: headerStyle LABEL/INTERNAL put data on row 2; BOTH puts
//   labels on row 1, internal names on row 2, data on row 3.
//
//   Section 7: association columns are appended after the primary object's
//   columns, headers prefixed by the object name ("Company (dot) Name").
//
// This file writes to a REAL temp file with ExcelJS and reads it back with a
// separate ExcelJS.Workbook instance - never asserting on an in-memory mock -
// because the whole point of these invariants is that the FILE is correct.
//
// Two judgment calls this file makes, since the given writeExport signature
// does not carry enough information to do otherwise:
//
//   - `associations` (from lib/export/associations.ts) already holds final,
//     per-record values - the writer places them directly into cells
//     (through sanitizeCell only, for safety) rather than re-running mapCell,
//     since writeExport is not given a PropertyDef map for the associated
//     object type.
//   - `associationSpec.columns` are raw internal names ('name', 'domain')
//     with no accompanying label, unlike the primary object's PropertyDef
//     map. FINDINGS section 7's own example ("Company (dot) Name", "Company
//     (dot) Domain") capitalizes the first letter of the raw column name, so
//     that is the convention this file expects: `${toObjectType} · ${Cap(column)}`.
//
// "Zero records" (requirement F) is exercised the same way an exhausted
// fetchRecords generator behaves (tests/export/fetch.test.ts): the async
// iterable yields no pages at all, not a page containing an empty array.

const MIDDLE_DOT = String.fromCharCode(0xb7);
const E_ACUTE = String.fromCharCode(0xe9);
const LF = String.fromCharCode(0x0a);
const ELLIPSIS_SUFFIX = ' [' + String.fromCharCode(0x2026) + ']';

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const FIRSTNAME_DEF: PropertyDef = { name: 'firstname', label: 'First Name', type: 'string', fieldType: 'text' };
const LASTNAME_DEF: PropertyDef = { name: 'lastname', label: 'Last Name', type: 'string', fieldType: 'text' };
const EMAIL_DEF: PropertyDef = { name: 'email', label: 'Email', type: 'string', fieldType: 'text' };
const PHONE_DEF: PropertyDef = { name: 'phone', label: 'Phone', type: 'string', fieldType: 'phonenumber' };
const AMOUNT_DEF: PropertyDef = { name: 'amount', label: 'Amount', type: 'number', fieldType: 'number' };
const CLOSEDATE_DEF: PropertyDef = { name: 'closedate', label: 'Close Date', type: 'date', fieldType: 'date' };
const MESSAGE_DEF: PropertyDef = { name: 'message', label: 'Message', type: 'string', fieldType: 'textarea' };

function record(id: string, properties: Record<string, string | null>): HubSpotRecord {
  return { id, properties };
}

function pages(...batches: HubSpotRecord[][]): AsyncIterable<HubSpotRecord[]> {
  return (async function* () {
    for (const batch of batches) yield batch;
  })();
}

function noPages(): AsyncIterable<HubSpotRecord[]> {
  return (async function* () {})();
}

function rowValues(row: ExcelJS.Row, count: number): unknown[] {
  return Array.from({ length: count }, (_unused, i) => row.getCell(i + 1).value);
}

const tempDirs: string[] = [];

async function tempFilePath(basename: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'writer-test-'));
  tempDirs.push(dir);
  return join(dir, basename);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function readWorkbook(filePath: string): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.getWorksheet('Export');
  if (!worksheet) throw new Error('Export worksheet not found in the written file');
  return worksheet;
}

describe('writeExport - invariant 1: one record produces exactly one row, always', () => {
  it('each record produces exactly one data row, across multiple yielded pages', async () => {
    const filePath = await tempFilePath('one-row.xlsx');
    const propertyDefs = new Map([
      ['firstname', FIRSTNAME_DEF],
      ['amount', AMOUNT_DEF],
    ]);

    const result = await writeExport({
      filePath,
      records: pages([record('1', { firstname: 'Ada', amount: '42' })], [record('2', { firstname: 'Grace', amount: '7' })]),
      properties: ['firstname', 'amount'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    expect(result.rowCount).toBe(2);

    const ws = await readWorkbook(filePath);
    expect(ws.rowCount).toBe(3); // 1 header + 2 data rows, one per record
    expect(ws.getRow(2).getCell(1).value).toBe('Ada');
    expect(ws.getRow(2).getCell(2).value).toBe(42);
    expect(ws.getRow(3).getCell(1).value).toBe('Grace');
    expect(ws.getRow(3).getCell(2).value).toBe(7);
  });
});

describe('writeExport - invariant 2: columns follow the properties order exactly, never sorted', () => {
  it('a reverse-alphabetical column order is preserved (spec fixture #10)', async () => {
    const filePath = await tempFilePath('order.xlsx');
    const propertyDefs = new Map([
      ['phone', PHONE_DEF],
      ['lastname', LASTNAME_DEF],
      ['firstname', FIRSTNAME_DEF],
      ['email', EMAIL_DEF],
    ]);
    const properties = ['phone', 'lastname', 'firstname', 'email']; // reverse-alphabetical

    await writeExport({
      filePath,
      records: pages([
        record('1', { phone: '0102030405', lastname: 'Lovelace', firstname: 'Ada', email: 'ada@example.com' }),
      ]),
      properties,
      propertyDefs,
      headerStyle: 'INTERNAL',
    });

    const ws = await readWorkbook(filePath);
    expect(rowValues(ws.getRow(1), 4)).toEqual(['phone', 'lastname', 'firstname', 'email']);
    expect(rowValues(ws.getRow(2), 4)).toEqual(['0102030405', 'Lovelace', 'Ada', 'ada@example.com']);
  });
});

describe('writeExport - invariant 3: dates are Excel dates, numbers are numbers, text is text', () => {
  it('each cell has the correct ExcelJS value type after a real write/read round trip', async () => {
    const filePath = await tempFilePath('types.xlsx');
    const propertyDefs = new Map([
      ['firstname', FIRSTNAME_DEF],
      ['amount', AMOUNT_DEF],
      ['closedate', CLOSEDATE_DEF],
    ]);

    await writeExport({
      filePath,
      records: pages([record('1', { firstname: 'Ada', amount: '1234.56', closedate: '2026-03-15T00:00:00.000Z' })]),
      properties: ['firstname', 'amount', 'closedate'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    const ws = await readWorkbook(filePath);
    const row = ws.getRow(2);

    expect(row.getCell(1).type).toBe(ExcelJS.ValueType.String);
    expect(row.getCell(1).value).toBe('Ada');

    expect(row.getCell(2).type).toBe(ExcelJS.ValueType.Number);
    expect(row.getCell(2).value).toBe(1234.56);

    expect(row.getCell(3).type).toBe(ExcelJS.ValueType.Date);
    expect(row.getCell(3).value).toBeInstanceOf(Date);
    expect((row.getCell(3).value as Date).getTime()).toBe(new Date('2026-03-15T00:00:00.000Z').getTime());
    // The specific defect this guards against: a HubSpot reference CSV
    // showed "2026-08-08 20:01" as inert TEXT, unsortable and
    // unfilterable as a date. `numFmt` (not just `type`) is what makes
    // this a real, sortable Excel date rather than a string that merely
    // looks date-shaped - checked here at the real read-back file level,
    // not just typeMap.ts's isolated mapCell unit test.
    expect(row.getCell(3).numFmt).toBe('yyyy-mm-dd');
  });

  it('a Create-Date-shaped datetime property (with a time-of-day, like HubSpot\'s own createdate/lastmodifieddate) is a real Excel date with a time-aware numFmt after a real write/read round trip', async () => {
    const filePath = await tempFilePath('createdate.xlsx');
    const CREATEDATE_DEF: PropertyDef = { name: 'createdate', label: 'Create Date', type: 'datetime', fieldType: 'date' };
    const propertyDefs = new Map([['createdate', CREATEDATE_DEF]]);

    await writeExport({
      filePath,
      records: pages([record('1', { createdate: '2026-08-09T00:01:08.512Z' })]),
      properties: ['createdate'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    const ws = await readWorkbook(filePath);
    const cell = ws.getRow(2).getCell(1);

    expect(cell.type).toBe(ExcelJS.ValueType.Date);
    expect(cell.value).toBeInstanceOf(Date);
    expect((cell.value as Date).getTime()).toBe(new Date('2026-08-09T00:01:08.512Z').getTime());
    expect(cell.numFmt).toBe('yyyy-mm-dd hh:mm');
  });
});

describe('writeExport - encoding: multi-byte/accented text survives a real write/read round trip intact', () => {
  it('French, German, Polish, and Japanese text all round-trip byte-for-byte - XLSX carries its own (UTF-8) encoding, unlike HubSpot\'s BOM-less UTF-8 CSV that Excel misreads as Latin-1', async () => {
    const filePath = await tempFilePath('encoding.xlsx');
    const propertyDefs = new Map([
      ['firstname', FIRSTNAME_DEF],
      ['lastname', LASTNAME_DEF],
      ['message', MESSAGE_DEF],
    ]);
    // "Première" mangled into "PremiÃ¨re" is exactly the defect observed in
    // HubSpot's own reference export (recon/FINDINGS.md, tests/fixtures/
    // hubspot-export-reference.csv) - here alongside a German umlaut, a
    // Polish surname, and Japanese, none of which are representable in
    // Latin-1 at all.
    await writeExport({
      filePath,
      records: pages([
        record('1', { firstname: 'M' + String.fromCharCode(0xfc) + 'ller', lastname: 'Kowalski', message: '日本語' }),
      ]),
      properties: ['firstname', 'lastname', 'message'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    const ws = await readWorkbook(filePath);
    const row = ws.getRow(2);
    expect(row.getCell(1).value).toBe('M' + String.fromCharCode(0xfc) + 'ller'); // Müller
    expect(row.getCell(2).value).toBe('Kowalski');
    expect(row.getCell(3).value).toBe('日本語');
  });

  it('the exact "Première ligne" text from the reference export round-trips intact, not mangled into "PremiÃ¨re ligne"', async () => {
    const filePath = await tempFilePath('encoding-premiere.xlsx');
    const propertyDefs = new Map([['message', MESSAGE_DEF]]);
    const text = 'Premi' + E_ACUTE + 're ligne';

    await writeExport({
      filePath,
      records: pages([record('1', { message: text })]),
      properties: ['message'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    const ws = await readWorkbook(filePath);
    expect(ws.getRow(2).getCell(1).value).toBe(text);
  });
});

// FINDINGS.md section 8's "third trap" (a referencedObjectType property's
// declared `type` lies - it's an identifier, not a number) applies with
// exactly the same force to hs_object_id: HubSpot's own record id. The
// difference is that hs_object_id has NO referencedObjectType (it's the
// record's own id, not a foreign-key pointer to another object), so the
// referencedObjectType guard alone never covers it - lib/export/typeMap.ts's
// looksLikeIdentifierName closes that gap by property NAME instead
// (anything ending in `_id`/`_key`), not by hardcoding this one property.
// This describe block checks both cases, at the real write/read file level
// (not just typeMap.ts's isolated mapCell unit).
describe('writeExport - long ids never get silently rounded by IEEE-754 double precision', () => {
  it('a referencedObjectType property (e.g. associatedcompanyid) with a 17-digit id lands as a real TEXT cell, exact digits preserved', async () => {
    const filePath = await tempFilePath('long-id-referenced.xlsx');
    const ASSOCIATED_COMPANY_DEF: PropertyDef = {
      name: 'associatedcompanyid',
      label: 'Associated Company',
      type: 'number',
      fieldType: 'number',
      referencedObjectType: 'COMPANY',
    };
    const longId = '12345678901234567'; // 17 digits
    const propertyDefs = new Map([['associatedcompanyid', ASSOCIATED_COMPANY_DEF]]);

    await writeExport({
      filePath,
      records: pages([record('1', { associatedcompanyid: longId })]),
      properties: ['associatedcompanyid'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    const ws = await readWorkbook(filePath);
    const cell = ws.getRow(2).getCell(1);
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.value).toBe(longId);
  });

  it('hs_object_id with a 17-digit value lands as text, exact digits preserved, at the real file level', async () => {
    // hs_object_id is declared `type: "number"` by HubSpot
    // (recon/sample-records.json: real ids arrive as plain numeric-looking
    // strings) and carries no referencedObjectType, so it isn't caught by
    // trap A's referencedObjectType guard. Fixed by
    // lib/export/typeMap.ts's looksLikeIdentifierName: hs_object_id ends
    // in `_id`, so a property-NAME check (not a hardcoded check for this
    // one property) forces it to text before the type/fieldType table ever
    // sees it. A 17-digit id is unambiguously beyond
    // Number.MAX_SAFE_INTEGER (2^53, 16 digits) - see
    // tests/export/typeMap.test.ts for the isolated unit-level proof this
    // was a real defect before the fix (12345678901234567 silently became
    // 12345678901234568).
    const filePath = await tempFilePath('long-id-hs-object-id.xlsx');
    const HS_OBJECT_ID_DEF: PropertyDef = { name: 'hs_object_id', label: 'Record ID', type: 'number', fieldType: 'number' };
    const longId = '12345678901234567'; // 17 digits
    const propertyDefs = new Map([['hs_object_id', HS_OBJECT_ID_DEF]]);

    await writeExport({
      filePath,
      records: pages([record('1', { hs_object_id: longId })]),
      properties: ['hs_object_id'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    const ws = await readWorkbook(filePath);
    const cell = ws.getRow(2).getCell(1);
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.value).toBe(longId);
  });
});

describe('writeExport - invariant 4: no cell contains null, undefined, NaN, or [object Object]', () => {
  it('a null property value produces a blank cell, never the literal text "null"', async () => {
    const filePath = await tempFilePath('null-value.xlsx');
    const propertyDefs = new Map([['phone', PHONE_DEF]]);

    await writeExport({
      filePath,
      records: pages([record('1', { phone: null })]),
      properties: ['phone'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    const ws = await readWorkbook(filePath);
    const cell = ws.getRow(2).getCell(1);
    expect(cell.type).toBe(ExcelJS.ValueType.Null);
    expect(cell.value).toBeNull();
  });

  it('an unparseable number produces a blank cell, never the literal text "NaN"', async () => {
    const filePath = await tempFilePath('nan-value.xlsx');
    const propertyDefs = new Map([['amount', AMOUNT_DEF]]);

    await writeExport({
      filePath,
      records: pages([record('1', { amount: 'n/a' })]),
      properties: ['amount'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    const ws = await readWorkbook(filePath);
    const cell = ws.getRow(2).getCell(1);
    expect(cell.type).toBe(ExcelJS.ValueType.Null);
    expect(cell.value).toBeNull();
  });
});

describe('writeExport - invariant 5: the file opens without a repair prompt', () => {
  it('a 40000-character property value is truncated cleanly and the file re-reads intact (spec fixture #8)', async () => {
    const filePath = await tempFilePath('huge-value.xlsx');
    const propertyDefs = new Map([
      ['firstname', FIRSTNAME_DEF],
      ['message', MESSAGE_DEF],
    ]);
    const hugeValue = 'x'.repeat(40000);

    await writeExport({
      filePath,
      records: pages([record('1', { firstname: 'Ada', message: hugeValue })]),
      properties: ['firstname', 'message'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    // Re-reading with an independent ExcelJS.Workbook instance without
    // throwing, and finding an intact, correctly-truncated cell plus an
    // unaffected neighbour, is the practical proxy for "opens without a
    // repair prompt": a malformed cell (e.g. from bad truncation) would
    // corrupt the row or break the reader outright.
    const ws = await readWorkbook(filePath);
    const text = ws.getRow(2).getCell(2).value as string;
    expect(text.length).toBeLessThanOrEqual(32767); // Excel's hard cell limit
    expect(text.length).toBe(32764); // sanitizeCell: truncate to 32760 + " […]"
    expect(text.endsWith(ELLIPSIS_SUFFIX)).toBe(true);
    expect(ws.getRow(2).getCell(1).value).toBe('Ada'); // neighbour cell unaffected
  });
});

describe('writeExport - A: extra always-returned keys never add columns or change order (FINDINGS section 10)', () => {
  it('createdate, hs_object_id and lastmodifieddate are present on the record but not requested, and are ignored', async () => {
    const filePath = await tempFilePath('extra-keys.xlsx');
    const propertyDefs = new Map([
      ['firstname', FIRSTNAME_DEF],
      ['email', EMAIL_DEF],
    ]);

    await writeExport({
      filePath,
      records: pages([
        record('1', {
          firstname: 'Ada',
          email: 'ada@example.com',
          createdate: '2026-01-01T00:00:00.000Z',
          hs_object_id: '123456',
          lastmodifieddate: '2026-01-02T00:00:00.000Z',
        }),
      ]),
      properties: ['firstname', 'email'],
      propertyDefs,
      headerStyle: 'INTERNAL',
    });

    const ws = await readWorkbook(filePath);
    expect(ws.actualColumnCount).toBe(2);
    expect(rowValues(ws.getRow(1), 2)).toEqual(['firstname', 'email']);
    expect(rowValues(ws.getRow(2), 2)).toEqual(['Ada', 'ada@example.com']);
  });
});

describe('writeExport - B: the real multi-line fixture stays one row, newlines preserved, wrapText set (FINDINGS section 9)', () => {
  it('three lines joined by bare LF produce one data row with wrapText on the cell', async () => {
    const filePath = await tempFilePath('multiline.xlsx');
    const propertyDefs = new Map([['message', MESSAGE_DEF]]);
    const raw =
      'Premi' + E_ACUTE + 're ligne' + LF + 'Deuxi' + E_ACUTE + 'me ligne' + LF + 'Troisi' + E_ACUTE + 'me ligne';

    await writeExport({
      filePath,
      records: pages([record('1', { message: raw })]),
      properties: ['message'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    const ws = await readWorkbook(filePath);
    expect(ws.rowCount).toBe(2); // header + exactly one data row, despite two embedded newlines
    const cell = ws.getRow(2).getCell(1);
    expect(cell.value).toBe(raw);
    expect((cell.value as string).split(LF)).toHaveLength(3);
    expect(cell.alignment?.wrapText).toBe(true);
  });
});

describe('writeExport - C: headerStyle controls which row data starts on', () => {
  it('LABEL: row 1 is labels, data from row 2', async () => {
    const filePath = await tempFilePath('header-label.xlsx');
    const propertyDefs = new Map([['firstname', FIRSTNAME_DEF]]);

    await writeExport({
      filePath,
      records: pages([record('1', { firstname: 'Ada' })]),
      properties: ['firstname'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    const ws = await readWorkbook(filePath);
    expect(ws.getRow(1).getCell(1).value).toBe('First Name');
    expect(ws.getRow(2).getCell(1).value).toBe('Ada');
    expect(ws.rowCount).toBe(2);
  });

  it('INTERNAL: row 1 is internal names, data from row 2', async () => {
    const filePath = await tempFilePath('header-internal.xlsx');
    const propertyDefs = new Map([['firstname', FIRSTNAME_DEF]]);

    await writeExport({
      filePath,
      records: pages([record('1', { firstname: 'Ada' })]),
      properties: ['firstname'],
      propertyDefs,
      headerStyle: 'INTERNAL',
    });

    const ws = await readWorkbook(filePath);
    expect(ws.getRow(1).getCell(1).value).toBe('firstname');
    expect(ws.getRow(2).getCell(1).value).toBe('Ada');
    expect(ws.rowCount).toBe(2);
  });

  it('BOTH: row 1 labels, row 2 internal names, data from row 3', async () => {
    const filePath = await tempFilePath('header-both.xlsx');
    const propertyDefs = new Map([['firstname', FIRSTNAME_DEF]]);

    await writeExport({
      filePath,
      records: pages([record('1', { firstname: 'Ada' })]),
      properties: ['firstname'],
      propertyDefs,
      headerStyle: 'BOTH',
    });

    const ws = await readWorkbook(filePath);
    expect(ws.getRow(1).getCell(1).value).toBe('First Name');
    expect(ws.getRow(2).getCell(1).value).toBe('firstname');
    expect(ws.getRow(3).getCell(1).value).toBe('Ada');
    expect(ws.rowCount).toBe(3);
  });
});

describe('writeExport - D: association columns are appended after the primary columns, headers prefixed by the object name', () => {
  it('a resolved association fills its columns; an unresolved one leaves them blank, not "undefined"', async () => {
    const filePath = await tempFilePath('associations.xlsx');
    const propertyDefs = new Map([['firstname', FIRSTNAME_DEF]]);
    const associationSpec = { toObjectType: 'Company', columns: ['name', 'domain'] };
    // lib/export/associations.ts's resolveAssociations already returns final
    // per-record values keyed by the primary record id.
    const associations = new Map([['1', { name: 'Acme Corp', domain: 'acme.com' }]]);

    await writeExport({
      filePath,
      records: pages([record('1', { firstname: 'Ada' }), record('2', { firstname: 'Grace' })]),
      properties: ['firstname'],
      propertyDefs,
      headerStyle: 'INTERNAL',
      associations,
      associationSpec,
    });

    const ws = await readWorkbook(filePath);
    expect(rowValues(ws.getRow(1), 3)).toEqual([
      'firstname',
      `Company ${MIDDLE_DOT} ${capitalize('name')}`,
      `Company ${MIDDLE_DOT} ${capitalize('domain')}`,
    ]);

    // record '1' has a resolved association - its columns come after "firstname".
    expect(rowValues(ws.getRow(2), 3)).toEqual(['Ada', 'Acme Corp', 'acme.com']);

    // record '2' has no association - the primary column is unaffected, and
    // the association columns are blank cells, not the text "undefined".
    const row3 = ws.getRow(3);
    expect(row3.getCell(1).value).toBe('Grace');
    expect(row3.getCell(2).type).toBe(ExcelJS.ValueType.Null);
    expect(row3.getCell(2).value).toBeNull();
    expect(row3.getCell(3).type).toBe(ExcelJS.ValueType.Null);
    expect(row3.getCell(3).value).toBeNull();
  });
});

describe('writeExport - E: a property missing from the payload entirely yields an empty cell, not "undefined"', () => {
  it('a requested property absent from record.properties (not even null) is a blank cell', async () => {
    const filePath = await tempFilePath('missing-key.xlsx');
    const propertyDefs = new Map([
      ['firstname', FIRSTNAME_DEF],
      ['email', EMAIL_DEF],
    ]);

    await writeExport({
      filePath,
      records: pages([record('1', { firstname: 'Ada' })]), // no "email" key at all
      properties: ['firstname', 'email'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    const ws = await readWorkbook(filePath);
    const row = ws.getRow(2);
    expect(row.getCell(1).value).toBe('Ada');
    expect(row.getCell(2).type).toBe(ExcelJS.ValueType.Null);
    expect(row.getCell(2).value).toBeNull();
  });
});

describe('writeExport - F: zero records still produces a file with headers only', () => {
  it('an exhausted (empty) records iterable still writes the header row and no data rows', async () => {
    const filePath = await tempFilePath('zero-records.xlsx');
    const propertyDefs = new Map([['firstname', FIRSTNAME_DEF]]);

    const result = await writeExport({
      filePath,
      records: noPages(),
      properties: ['firstname'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    expect(result.rowCount).toBe(0);

    const ws = await readWorkbook(filePath);
    expect(ws.rowCount).toBe(1); // header only
    expect(rowValues(ws.getRow(1), 1)).toEqual(['First Name']);
  });
});

describe('writeExport - sanitisation (spec section 3) runs before type coercion (rule 6), not after', () => {
  it('a control char followed by a leading "=" is sanitised BEFORE mapCell, so the exposed "=" still gets quoted', async () => {
    // specs/05-EXPORT-ENGINE.md section 3: rule 2 (strip control chars) runs
    // before rule 4 (quote a leading = + - @); rule 6 (type coercion, i.e.
    // mapCell) is separate and comes last. Feeding mapCell the UNSANITISED
    // raw value first would let it see a control char at position 0 -
    // irrelevant for plain string/text, but the writer must not depend on
    // that: it has to sanitise raw string values before mapCell, not after.
    const filePath = await tempFilePath('sanitise-before-coerce.xlsx');
    const propertyDefs = new Map([['firstname', FIRSTNAME_DEF]]);
    const raw = String.fromCharCode(0x07) + '=SUM(1,1)'; // BEL, then a leading "="

    await writeExport({
      filePath,
      records: pages([record('1', { firstname: raw })]),
      properties: ['firstname'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    const ws = await readWorkbook(filePath);
    const cell = ws.getRow(2).getCell(1);
    // Strip the control char first (rule 2), which exposes "=" as the new
    // leading character, THEN quote it (rule 4).
    expect(cell.value).toBe("'=SUM(1,1)");
  });

  it('a control char before a number is stripped BEFORE type coercion, so the number survives (not lost to the NaN guard)', async () => {
    // If mapCell ran on the unsanitised raw value, parseFloat(BEL + '42')
    // would fail, and mapCell's own NaN guard would silently turn it into an
    // empty cell - the "42" would be gone with no error. Sanitising the
    // control character away first is what lets it parse at all.
    const filePath = await tempFilePath('control-char-number.xlsx');
    const propertyDefs = new Map([['amount', AMOUNT_DEF]]);
    const raw = String.fromCharCode(0x07) + '42'; // BEL, then a plain number

    await writeExport({
      filePath,
      records: pages([record('1', { amount: raw })]),
      properties: ['amount'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    const ws = await readWorkbook(filePath);
    const cell = ws.getRow(2).getCell(1);
    expect(cell.type).toBe(ExcelJS.ValueType.Number);
    expect(cell.value).toBe(42);
  });

  it('a negative number is not corrupted by the leading-character quote defence meant for text cells', async () => {
    // Naively sanitising before coercion would turn "-5" into "'-5" (rule 4
    // treats a leading "-" as a possible formula/injection attempt), and
    // that quoted string then fails to parse as a number at all. Rule 4 only
    // protects a cell that ends up as TEXT - a number cell is never
    // formula-evaluable, so the writer undoes a quote IT added before
    // handing the value to mapCell, letting "-5" parse as the number -5.
    const filePath = await tempFilePath('negative-number.xlsx');
    const propertyDefs = new Map([['amount', AMOUNT_DEF]]);

    await writeExport({
      filePath,
      records: pages([record('1', { amount: '-5' })]),
      properties: ['amount'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    const ws = await readWorkbook(filePath);
    const cell = ws.getRow(2).getCell(1);
    expect(cell.type).toBe(ExcelJS.ValueType.Number);
    expect(cell.value).toBe(-5);
  });
});

// Column widths - specs/05-EXPORT-ENGINE.md section 5: "Column width =
// min(max(headerLength, 12), 50)." Observed on a real export: widths were
// set for columns A, D and E only, B and C had none and Excel fell back to
// its default. Every column is now assigned its width in an explicit,
// per-column loop (lib/export/writer.ts) rather than a single batch
// `sheet.columns = [...]` assignment, specifically so this can never depend
// on any other column's width/style - each one is independent.
describe('writeExport - column widths: every column in the used range has an explicit width', () => {
  it('five columns with varied header lengths, including two adjacent columns short enough to clamp to the same width, all get an explicit width - none fall back to Excel\'s default', async () => {
    const filePath = await tempFilePath('column-widths.xlsx');
    const propertyDefs = new Map([
      ['a', { name: 'a', label: 'A Very Long Header Name Indeed', type: 'string', fieldType: 'text' } as PropertyDef],
      ['b', { name: 'b', label: 'B', type: 'string', fieldType: 'text' } as PropertyDef], // clamps to the 12-char floor
      ['c', { name: 'c', label: 'C', type: 'string', fieldType: 'text' } as PropertyDef], // clamps to the same floor as B
      ['d', { name: 'd', label: 'D Long Header', type: 'string', fieldType: 'text' } as PropertyDef],
      ['e', { name: 'e', label: 'E Even Longer Header Name Here', type: 'string', fieldType: 'text' } as PropertyDef],
    ]);

    await writeExport({
      filePath,
      records: pages([record('1', { a: '1', b: '2', c: '3', d: '4', e: '5' })]),
      properties: ['a', 'b', 'c', 'd', 'e'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    const ws = await readWorkbook(filePath);
    for (let col = 1; col <= 5; col++) {
      const width = ws.getColumn(col).width;
      expect(width, `column ${col} has no explicit width`).toBeDefined();
      expect(Number.isFinite(width)).toBe(true);
      expect(width as number).toBeGreaterThanOrEqual(12);
      expect(width as number).toBeLessThanOrEqual(50);
    }
  });

  it('an association column (no PropertyDef at all) also gets an explicit width', async () => {
    const filePath = await tempFilePath('column-widths-association.xlsx');
    const propertyDefs = new Map([['firstname', FIRSTNAME_DEF]]);

    await writeExport({
      filePath,
      records: pages([record('1', { firstname: 'Ada' })]),
      properties: ['firstname'],
      propertyDefs,
      headerStyle: 'LABEL',
      associations: new Map([['1', { name: 'Acme Corp' }]]),
      associationSpec: { toObjectType: 'Company', columns: ['name'] },
    });

    const ws = await readWorkbook(filePath);
    expect(ws.actualColumnCount).toBe(2);
    expect(ws.getColumn(1).width).toBeDefined();
    expect(ws.getColumn(2).width).toBeDefined(); // the association column
  });
});

describe('writeExport - column widths: a wrapText column is wider than a plain text one', () => {
  it('a textarea (wrapText) column with a short label is wider than a plain text column with an equally short label', async () => {
    const filePath = await tempFilePath('column-widths-wraptext.xlsx');
    const propertyDefs = new Map([
      ['note', { ...MESSAGE_DEF, name: 'note', label: 'A' } as PropertyDef], // textarea, 1-char label
      ['tag', { name: 'tag', label: 'B', type: 'string', fieldType: 'text' } as PropertyDef], // plain text, 1-char label
    ]);

    await writeExport({
      filePath,
      records: pages([record('1', { note: 'line one' + LF + 'line two', tag: 'x' })]),
      properties: ['note', 'tag'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    const ws = await readWorkbook(filePath);
    const noteWidth = ws.getColumn(1).width as number;
    const tagWidth = ws.getColumn(2).width as number;

    expect(noteWidth).toBeGreaterThan(12); // wider than the plain 12-character floor
    expect(noteWidth).toBeGreaterThan(tagWidth);
    expect(noteWidth).toBeLessThanOrEqual(50); // still capped, per spec
    expect(tagWidth).toBe(12); // unaffected - the plain column stays at the floor
  });

  it('a wrapText column whose header is already long is still capped at 50', async () => {
    const filePath = await tempFilePath('column-widths-wraptext-long-header.xlsx');
    const longLabel = 'A'.repeat(80);
    const propertyDefs = new Map([['note', { ...MESSAGE_DEF, name: 'note', label: longLabel } as PropertyDef]]);

    await writeExport({
      filePath,
      records: pages([record('1', { note: 'line one' + LF + 'line two' })]),
      properties: ['note'],
      propertyDefs,
      headerStyle: 'LABEL',
    });

    const ws = await readWorkbook(filePath);
    expect(ws.getColumn(1).width).toBe(50);
  });
});
