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
import { mapCell, columnWrapsText, type PropertyDef } from '@/lib/export/typeMap';
import { sanitizeCell, sanitizeRawForCoercion } from '@/lib/export/sanitize';

const HEADER_FILL_ARGB = 'FF2E3B4E';
const HEADER_FONT_ARGB = 'FFFFFFFF';
const MIN_COLUMN_WIDTH = 12;
/**
 * A wrapText column (e.g. a textarea Notes field) holding several lines is
 * unreadable at the plain MIN_COLUMN_WIDTH - a 3-line note in a 12-character
 * column is unusable without the customer resizing it by hand. Still capped
 * by MAX_COLUMN_WIDTH like every other column (spec section 5's formula).
 */
const WRAP_TEXT_MIN_WIDTH = 40;
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

/**
 * spec section 5: `min(max(headerLength, 12), 50)`. `wraps` widens the floor
 * to WRAP_TEXT_MIN_WIDTH for a column that will hold multi-line values - a
 * three-line note is unreadable at 12 characters wide. `headerLength` is
 * defensively coerced to a finite number: this is the one formula every
 * column's width comes from, and a column whose header text was ever
 * missing/non-string must still get a real width, never `NaN` (which
 * `Column.width` would silently accept, and which ExcelJS's `<col>` writer
 * then omits the `width` attribute for entirely - Excel falls back to its
 * own default, exactly the "column has no width" symptom this fixes).
 */
function columnWidth(headerLength: number, wraps: boolean): number {
  const safeLength = Number.isFinite(headerLength) ? headerLength : 0;
  const floor = wraps ? WRAP_TEXT_MIN_WIDTH : MIN_COLUMN_WIDTH;
  return Math.min(Math.max(safeLength, floor), MAX_COLUMN_WIDTH);
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

  // Property-level trait (not per-value), so it's known before any row is
  // written - see typeMap.ts's columnWrapsText. Association columns have no
  // PropertyDef and never wrap.
  const wrapsTextRow = [
    ...properties.map((name) => columnWrapsText(propertyDefs.get(name))),
    ...associationColumns.map(() => false),
  ];

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true });
  const sheet = workbook.addWorksheet('Export', {
    views: [{ state: 'frozen', ySplit: dataStartRow - 1 }],
  });

  // Set explicitly, one column at a time - not via a single `sheet.columns =
  // [...]` batch assignment. Every column gets its own direct width write
  // here, by column number, so there is no shared array-conversion step
  // (ExcelJS's Column.toModel/equivalentTo consolidation of the whole
  // array) whose behaviour depends on every other column's width too.
  for (let i = 0; i < columnCount; i++) {
    sheet.getColumn(i + 1).width = columnWidth(String(labelHeaderRow[i]).length, wrapsTextRow[i]);
  }

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
