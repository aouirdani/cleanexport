/**
 * The preview pipeline - specs/07-TASKS.md T18; specs/06-API-CONTRACT.md
 * `POST /api/exports/:id/preview` and `POST /api/exports/preview`.
 *
 * "It must use the SAME pipeline as a real export - fetchRecords, mapCell,
 * sanitizeCell - otherwise the preview lies." This file calls exactly those
 * functions (plus lib/export/sanitize.ts's `sanitizeRawForCoercion` and
 * lib/export/typeMap.ts's `columnValueType`, both imported rather than
 * reimplemented - see each import site below), in exactly the order
 * lib/export/writer.ts calls them, so a cell's mapped/sanitized VALUE here
 * is byte-identical to what ends up in the real .xlsx for the same input.
 * There is exactly one implementation of each rule; this file and
 * lib/export/writer.ts are two callers of it, not two copies.
 *
 * Response shape decision (the task asks for this to be stated explicitly):
 * a cell in `sampleRows` is `string | number | boolean | null` - a `Date`
 * is serialised via `.toISOString()`. The original type is NOT re-derived
 * from that JSON value (a null date and a null number are both JSON `null`
 * and indistinguishable from each other, and a date string and a plain
 * text string are both JSON strings). Instead, each column carries its own
 * `type` once, in `columns[i].type` - one of 'text' | 'number' | 'date' |
 * 'datetime' | 'boolean', decided from the PropertyDef, matching
 * specs/05-EXPORT-ENGINE.md sections 4.0/4's table - not from any single
 * row's value, which can legitimately be null. `sampleRows[r][i]` and
 * `columns[i]` are paired positionally, the same "order is the point, never
 * a keyed lookup" discipline as `ExportDefinition.properties` itself
 * (specs/AGENTS.md rule 9).
 *
 * "Take the first page and stop": this calls the fetchRecords generator's
 * `.next()` exactly once. A page is up to 100 records (lib/export/fetch.ts's
 * PAGE_LIMIT) and the preview only ever needs PREVIEW_ROW_LIMIT (20), so one
 * page is always enough when there's any data at all; when there's none,
 * fetchRecords never yields anything and `.next()` resolves `{ done: true }`
 * on the first call, which reads here as an empty page, not an error.
 *
 * Plan gating: previews don't count toward anything (specs/06-API-CONTRACT.md
 * doesn't list them under "Plan gating"), but they DO make a real HubSpot
 * call, through the same `HubSpotClient` a real export uses - so they get
 * the same per-portal rate limiter and backoff for free, not a bypass.
 */

import type { HubSpotClient } from '@/lib/hubspot/client';
import { fetchRecords, type Filters, type HubSpotRecord } from '@/lib/export/fetch';
import { mapCell, columnValueType, type PropertyDef, type PropertyValueKind } from '@/lib/export/typeMap';
import { sanitizeCell, sanitizeRawForCoercion } from '@/lib/export/sanitize';
import { resolveAssociations } from '@/lib/export/associations';
import { AppError, ErrorCode, type ErrorCodeValue } from '@/lib/errors';

/** specs/06-API-CONTRACT.md: "at most 20 rows." */
export const PREVIEW_ROW_LIMIT = 20;

/** Re-exported under this file's own name for callers (route handlers, tests) that don't need to know it lives in typeMap.ts. */
export { columnValueType };
export type PreviewColumnType = PropertyValueKind;

export interface PreviewColumn {
  /** Stable React-list key. The internal property name for a primary column,
   *  `assoc:<column>` for an association column (properties and association
   *  column names live in separate namespaces and could otherwise collide). */
  key: string;
  header: string;
  type: PreviewColumnType;
}

export type PreviewCellValue = string | number | boolean | null;

export interface PreviewResult {
  columns: PreviewColumn[];
  sampleRows: PreviewCellValue[][];
}

export interface PreviewAssociationSpec {
  toObjectType: string; // e.g. "COMPANIES" - the ObjectType enum value
  columns: string[];
}

export interface PreviewDefinitionInput {
  objectType: string; // e.g. "CONTACTS" - the ObjectType enum value
  properties: string[];
  headerStyle: 'LABEL' | 'INTERNAL' | 'BOTH';
  filters?: Filters | null;
  associations?: PreviewAssociationSpec | null;
}

/** Same per-cell pipeline as lib/export/writer.ts's row loop, value for value - both call the same two imported functions. */
function mapAndSanitize(
  raw: unknown,
  def: PropertyDef | undefined,
  owners: Map<string, { name: string; email: string }> | undefined,
): unknown {
  const preparedRaw = typeof raw === 'string' ? sanitizeRawForCoercion(raw) : raw;
  const mapped = def ? mapCell(preparedRaw, def, { owners }) : { value: preparedRaw };
  return sanitizeCell(mapped.value);
}

/** A cell value already through sanitizeCell (string | number | boolean | Date | null) -> JSON-safe. */
function serializeCellValue(value: unknown): PreviewCellValue {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Duplicated from inngest/exportRun.ts's private DISPLAY_OBJECT_TYPE map -
 * that file is forbidden to modify and does not export it. Only four
 * object types exist (the ObjectType enum), so this is an exact, stable
 * lookup, not a heuristic - see that file's own comment for why a lookup
 * table beats pluralisation logic.
 */
const OBJECT_TYPE_DISPLAY_NAME: Record<string, string> = {
  CONTACTS: 'Contact',
  COMPANIES: 'Company',
  DEALS: 'Deal',
  TICKETS: 'Ticket',
};

function primaryColumnHeader(
  propertyName: string,
  def: PropertyDef | undefined,
  headerStyle: PreviewDefinitionInput['headerStyle'],
): string {
  const label = def?.label ?? propertyName;
  switch (headerStyle) {
    case 'INTERNAL':
      return propertyName;
    case 'BOTH':
      // The real export renders label and internal name as two physical
      // header ROWS (specs/05-EXPORT-ENGINE.md section 5). This preview is a
      // single-header-row table, so both pieces of information are folded
      // into one line instead of being dropped.
      return `${label} (${propertyName})`;
    case 'LABEL':
    default:
      return label;
  }
}

export interface RunPreviewOptions {
  client: HubSpotClient;
  propertyDefs: Map<string, PropertyDef>;
  owners?: Map<string, { name: string; email: string }>;
  definition: PreviewDefinitionInput;
}

export async function runPreview({ client, propertyDefs, owners, definition }: RunPreviewOptions): Promise<PreviewResult> {
  const objectTypeSlug = definition.objectType.toLowerCase();

  // specs/05-EXPORT-ENGINE.md section 8: a property no longer in the portal
  // is skipped, same as a real run - never fetched, never a column.
  const knownProperties = definition.properties.filter((p) => propertyDefs.has(p));

  const generator = fetchRecords(client, objectTypeSlug, knownProperties, definition.filters ?? undefined, propertyDefs);
  const { value: firstPage } = await generator.next(); // "take the first page and stop" - never call .next() again
  const records: HubSpotRecord[] = (firstPage ?? []).slice(0, PREVIEW_ROW_LIMIT);

  const associationValuesByRecordId = definition.associations
    ? await resolveAssociations(
        client,
        objectTypeSlug,
        records.map((r) => r.id),
        { toObjectType: definition.associations.toObjectType.toLowerCase(), columns: definition.associations.columns },
      )
    : null;

  const columns: PreviewColumn[] = [
    ...knownProperties.map((name): PreviewColumn => {
      const def = propertyDefs.get(name);
      return { key: name, header: primaryColumnHeader(name, def, definition.headerStyle), type: columnValueType(def) };
    }),
    ...(definition.associations?.columns ?? []).map((col): PreviewColumn => ({
      key: `assoc:${col}`,
      header: `${OBJECT_TYPE_DISPLAY_NAME[definition.associations!.toObjectType] ?? definition.associations!.toObjectType} · ${capitalize(col)}`,
      // Association values go through sanitizeCell only, never mapCell
      // (lib/export/writer.ts does the same) - always text, matching the
      // real export exactly, even where that looks surprising for e.g. a
      // numeric associated property.
      type: 'text',
    })),
  ];

  const sampleRows: PreviewCellValue[][] = records.map((record) => {
    const primaryValues = knownProperties.map((name) =>
      serializeCellValue(mapAndSanitize(record.properties[name] ?? null, propertyDefs.get(name), owners)),
    );
    const associationValues = (definition.associations?.columns ?? []).map((col) =>
      serializeCellValue(sanitizeCell(associationValuesByRecordId?.get(record.id)?.[col] ?? null)),
    );
    return [...primaryValues, ...associationValues];
  });

  return { columns, sampleRows };
}

export interface ClassifiedPreviewError {
  status: number;
  code: ErrorCodeValue;
  message: string;
}

/**
 * specs/07-TASKS.md T18: "errors surface in plain language: a bad filter, a
 * revoked token, or the 10,000 search cap each say what to do next." Mirrors
 * the plain-language discipline of inngest/email.ts's FAILURE_ADVICE map
 * (not imported - that map is private to that file, and its copy is
 * addressed to "your scheduled export", not a live preview click) rather
 * than ever showing a raw HubSpot response body or a stack trace.
 */
export function classifyPreviewError(err: unknown): ClassifiedPreviewError {
  if (err instanceof AppError) {
    switch (err.code) {
      case ErrorCode.TOKEN_REVOKED:
        return {
          status: 401,
          code: err.code,
          message: 'Your HubSpot connection was disconnected. Reconnect HubSpot to preview this export.',
        };
      case ErrorCode.SEARCH_CAP_EXCEEDED:
        return {
          status: 400,
          code: err.code,
          message:
            'Your filters matched more than HubSpot allows a single search to return. Add a narrower filter (for example a shorter date range) and try again.',
        };
      case ErrorCode.RATE_LIMITED:
        return {
          status: 429,
          code: err.code,
          message: 'HubSpot rate-limited this portal. Wait a moment and try again.',
        };
      case ErrorCode.HUBSPOT_ERROR:
        return {
          status: 400,
          code: err.code,
          message: 'HubSpot rejected this request - double-check your filters and try again.',
        };
      default:
        return { status: err.status, code: err.code, message: err.message };
    }
  }
  return { status: 500, code: ErrorCode.INTERNAL, message: 'Something went wrong while building the preview.' };
}
