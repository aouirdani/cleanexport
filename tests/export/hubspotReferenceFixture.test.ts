import { describe, it, expect, afterEach } from 'vitest';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { writeExport } from '@/lib/export/writer';
import type { PropertyDef } from '@/lib/export/typeMap';

/**
 * Regression fixture for the landing page's HubSpot-CSV-vs-our-XLSX
 * comparison: tests/fixtures/hubspot-export-reference.csv is a real
 * HubSpot contact export (2 contacts, Brian and Maria - the same two
 * records as recon/sample-records.json), reproduced byte-for-byte:
 *   - UTF-8, no BOM (defect 1's trap: Excel misreads a BOM-less UTF-8 CSV
 *     as Latin-1, mangling "Première" into "PremiÃ¨re" - but the file's
 *     ACTUAL bytes are valid UTF-8, so a conforming reader is unaffected).
 *   - Brian's Message field is a real 3-line value, properly quoted per
 *     RFC4180 (embedded raw LFs inside a quoted field are legal CSV) -
 *     recon/FINDINGS.md section 9's exact text.
 *
 * "Conforming CSV parser" below means one that actually implements
 * RFC4180 quoting (a quoted field may contain literal commas/newlines,
 * and "" is an escaped quote) - deliberately NOT a naive `split('\n')`,
 * since a naive line-split is exactly the kind of parser that WOULD
 * wrongly see Brian's contact as three rows. This is the whole point of
 * the comparison: read correctly, the reference file is unambiguous.
 */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      field = '';
      records.push(row);
      row = [];
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  return records;
}

const FIXTURE_PATH = join(process.cwd(), 'tests/fixtures/hubspot-export-reference.csv');

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function tempFilePath(basename: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fixture-test-'));
  tempDirs.push(dir);
  return join(dir, basename);
}

describe('tests/fixtures/hubspot-export-reference.csv - the reference file our landing page compares against', () => {
  it('is valid UTF-8 with no BOM (defect 1\'s precondition: the mangling is Excel misreading a correctly-encoded file, not a corrupt one)', async () => {
    const bytes = await readFile(FIXTURE_PATH);
    expect(bytes[0]).not.toBe(0xef); // UTF-8 BOM starts EF BB BF
    // Re-decoding the raw bytes as UTF-8 and finding the correct accented
    // character proves the file itself is intact UTF-8, not mojibake baked
    // into the fixture by mistake.
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    expect(text).toContain('Première ligne');
  });

  it('a conforming (RFC4180-quote-aware) CSV parser reads exactly 2 records, despite Brian\'s 3-line Message field', async () => {
    const text = await readFile(FIXTURE_PATH, 'utf-8');
    const rows = parseCsv(text);
    const [header, ...dataRows] = rows;

    expect(header).toEqual(['Record ID', 'First Name', 'Email', 'City', 'Create Date', 'Message']);
    expect(dataRows).toHaveLength(2);

    expect(dataRows[0][0]).toBe('840926056668'); // Brian
    expect(dataRows[0][5]).toBe('Première ligne\nDeuxième ligne\nTroisième ligne');
    expect(dataRows[1][0]).toBe('840928535743'); // Maria
  });

  it('our own XLSX export of the same two contacts also contains exactly 2 data rows - the comparison the landing page makes is pinned to real numbers on both sides', async () => {
    const filePath = await tempFilePath('reference-comparison.xlsx');
    const RECORD_ID_DEF: PropertyDef = { name: 'hs_object_id', label: 'Record ID', type: 'string', fieldType: 'text' };
    const FIRSTNAME_DEF: PropertyDef = { name: 'firstname', label: 'First Name', type: 'string', fieldType: 'text' };
    const EMAIL_DEF: PropertyDef = { name: 'email', label: 'Email', type: 'string', fieldType: 'text' };
    const CITY_DEF: PropertyDef = { name: 'city', label: 'City', type: 'string', fieldType: 'text' };
    const MESSAGE_DEF: PropertyDef = { name: 'message', label: 'Message', type: 'string', fieldType: 'textarea' };
    const propertyDefs = new Map([
      ['hs_object_id', RECORD_ID_DEF],
      ['firstname', FIRSTNAME_DEF],
      ['email', EMAIL_DEF],
      ['city', CITY_DEF],
      ['message', MESSAGE_DEF],
    ]);
    const properties = ['hs_object_id', 'firstname', 'email', 'city', 'message'];

    // The same two contacts as the reference CSV (and recon/sample-records.json) -
    // hs_object_id is deliberately given a plain `string` PropertyDef here
    // (not `number`), sidestepping the still-open hs_object_id-as-number
    // finding from tests/export/typeMap.test.ts and tests/export/writer.test.ts -
    // this test is about row COUNT, not id precision, which is covered
    // separately.
    const records = [
      {
        id: '840926056668',
        properties: {
          hs_object_id: '840926056668',
          firstname: 'Brian',
          email: 'bh@hubspot.com',
          city: 'Cambridge',
          message: 'Première ligne\nDeuxième ligne\nTroisième ligne',
        },
      },
      {
        id: '840928535743',
        properties: {
          hs_object_id: '840928535743',
          firstname: 'Maria',
          email: 'emailmaria@hubspot.com',
          city: 'Brisbane',
          message: null,
        },
      },
    ];

    const result = await writeExport({
      filePath,
      records: (async function* () {
        yield records;
      })(),
      properties,
      propertyDefs,
      headerStyle: 'LABEL',
    });

    expect(result.rowCount).toBe(2);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const ws = workbook.getWorksheet('Export');
    if (!ws) throw new Error('Export worksheet not found');

    expect(ws.rowCount).toBe(3); // 1 header + 2 data rows - one per contact, never split
    expect(ws.getRow(2).getCell(1).value).toBe('840926056668');
    expect(ws.getRow(3).getCell(1).value).toBe('840928535743');
  });
});
