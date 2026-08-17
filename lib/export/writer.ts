/**
 * Streams CRM records into an .xlsx file - specs/05-EXPORT-ENGINE.md
 * sections 1, 2, 5, 7, 10; recon/FINDINGS.md sections 9, 10.
 *
 * ExcelJS.stream.xlsx.WorkbookWriter, never the in-memory Workbook: a
 * 250,000-row export must keep memory flat. Fetch a page, write its rows,
 * discard, next page - nothing is accumulated in an array.
 *
 * The single most important line in this file: iterate `properties` (the
 * user's ordered array), never Object.keys(record.properties). HubSpot
 * always returns createdate, hs_object_id and lastmodifieddate whether or
 * not they were requested (FINDINGS section 10) - iterating the payload's
 * own keys would add unrequested columns and destroy the configured order.
 */

import ExcelJS from 'exceljs';
import type { HubSpotRecord } from '@/lib/export/fetch';
import { mapCell, type PropertyDef } from '@/lib/export/typeMap';
import { sanitizeCell } from '@/lib/export/sanitize';

const HEADER_FILL_ARGB = 'FF2E3B4E';
const HEADER_FONT_ARGB = 'FFFFFFFF';
const MIN_COLUMN_WIDTH = 12;
const MAX_COLUMN_WIDTH = 50;

export interface WriteExportOptions {
  filePath: string;
  records: AsyncIterable<HubSpotRecord[]>;
  /** The user's configured column order. Iterated as-is - never sorted. */
  properties: string[];
  propertyDefs: Map<string, PropertyDef>;
  headerStyle: 'LABEL' | 'INTERNAL' | 'BOTH';
  /** From lib/export/associations.ts - already resolved, final per-record values. */
  associations?: Map<string, Record<string, unknown>>;
  associationSpec?: { toObjectType: string; columns: string[] };
  owners?: Map<string, { name: string; email: string }>;
  timezone?: string;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function columnWidth(headerLength: number): number {
  return Math.min(Math.max(headerLength, MIN_COLUMN_WIDTH), MAX_COLUMN_WIDTH);
}

/**
 * Prepares a raw string for mapCell (spec section 3, rule 6: type coercion
 * runs LAST, after sanitisation). Runs sanitizeCell first so control
 * characters are stripped and line endings normalised before mapCell parses
 * the value - otherwise a stray control character (e.g. a raw value of
 * String.fromCharCode(0x07) + '42') breaks parseFloat and the number is
 * silently lost to the NaN guard.
 *
 * Rule 4 (quote a leading = + - @) is a defence for TEXT cells against
 * formula injection - it is meaningless for a cell that mapCell is about to
 * turn into a number, date, or boolean, and actively harmful: "-5" would
 * become "'-5", which then fails to parse as a number at all. So a quote
 * ADDED by this pass is undone before coercion; mapCell always sees the
 * value with its original leading character. If the coerced result is
 * still a string, the existing post-coercion `sanitizeCell(mapped.value)`
 * call below re-applies rule 4 to it - injection defence on the actual text
 * that ends up in the cell is unaffected.
 */
function sanitizeRawForCoercion(raw: string): string {
  const sanitized = sanitizeCell(raw);
  const text = typeof sanitized === 'string' ? sanitized : raw; // sanitizeCell(string) always returns a string
  if (text.startsWith("'") && !raw.startsWith("'")) return text.slice(1);
  return text;
}

function applyHeaderRowStyle(row: ExcelJS.Row, columnCount: number): void {
  for (let col = 1; col <= columnCount; col++) {
    const cell = row.getCell(col);
    cell.font = { bold: true, color: { argb: HEADER_FONT_ARGB } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL_ARGB } };
  }
}

export async function writeExport(opts: WriteExportOptions): Promise<{ rowCount: number }> {
  const { filePath, properties, propertyDefs, headerStyle, associations, associationSpec, owners } = opts;

  const associationColumns = associationSpec?.columns ?? [];
  // Association columns have no PropertyDef, so no internal-name/label split
  // exists for them: the prefixed header ("Company · Name") is used under
  // every headerStyle (spec section 7).
  const associationHeaders = associationColumns.map((col) => `${associationSpec?.toObjectType} · ${capitalize(col)}`);

  const propertyLabels = properties.map((name) => propertyDefs.get(name)?.label ?? name);
  const labelHeaderRow = [...propertyLabels, ...associationHeaders];
  const internalHeaderRow = [...properties, ...associationHeaders];
  const columnCount = internalHeaderRow.length;
  const dataStartRow = headerStyle === 'BOTH' ? 3 : 2;

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true });
  const sheet = workbook.addWorksheet('Export', {
    views: [{ state: 'frozen', ySplit: dataStartRow - 1 }],
  });

  sheet.columns = internalHeaderRow.map((_name, i) => ({
    width: columnWidth(String(labelHeaderRow[i]).length),
  }));

  if (headerStyle === 'LABEL' || headerStyle === 'BOTH') {
    const row = sheet.getRow(1);
    row.values = labelHeaderRow;
    applyHeaderRowStyle(row, columnCount);
    row.commit();
  }
  if (headerStyle === 'INTERNAL') {
    const row = sheet.getRow(1);
    row.values = internalHeaderRow;
    applyHeaderRowStyle(row, columnCount);
    row.commit();
  }
  if (headerStyle === 'BOTH') {
    const row = sheet.getRow(2);
    row.values = internalHeaderRow;
    applyHeaderRowStyle(row, columnCount);
    row.commit();
  }

  let rowIndex = dataStartRow;
  let rowCount = 0;

  for await (const page of opts.records) {
    for (const record of page) {
      const row = sheet.getRow(rowIndex);
      let col = 1;

      for (const propertyName of properties) {
        const def = propertyDefs.get(propertyName);
        const raw = record.properties[propertyName] ?? null;
        const preparedRaw = typeof raw === 'string' ? sanitizeRawForCoercion(raw) : raw;
        const mapped = def ? mapCell(preparedRaw, def, { owners }) : { value: preparedRaw };
        const cell = row.getCell(col);
        cell.value = sanitizeCell(mapped.value);
        if (mapped.numFmt) cell.numFmt = mapped.numFmt;
        if (mapped.wrapText) cell.alignment = { wrapText: true };
        col++;
      }

      const associationValues = associations?.get(record.id);
      for (const columnName of associationColumns) {
        const raw = associationValues?.[columnName] ?? null;
        row.getCell(col).value = sanitizeCell(raw);
        col++;
      }

      row.commit();
      rowIndex++;
      rowCount++;
    }
  }

  const lastDataRow = rowIndex - 1;
  if (lastDataRow >= dataStartRow) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: lastDataRow, column: columnCount },
    };
  }

  await workbook.commit();

  return { rowCount };
}
