/**
 * Cell type mapping - specs/05-EXPORT-ENGINE.md sections 4.0 and 4.
 *
 * Dispatch order, in this exact sequence:
 *   1. referencedObjectType (section 4.0) - a property that references another
 *      object is an identifier, and its declared `type` is misleading. Checked
 *      BEFORE the type/fieldType table below, not as a special case inside it.
 *   2. a table-driven switch on `type` (mapByType) - type decides value semantics.
 *   3. `fieldType` never drives that switch. It only decides wrapText (mapString)
 *      and multi-select splitting (mapEnumeration), inside the branch that `type`
 *      already selected.
 *
 * Every value from HubSpot arrives as string | null (recon/FINDINGS.md section 3).
 * This function parses, it does not merely format.
 */

export interface PropertyDef {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  options?: { value: string; label: string }[];
  referencedObjectType?: string;
}

export interface MappedCell {
  value: string | number | boolean | Date | null;
  numFmt?: string;
  wrapText?: boolean;
}

interface MapCellContext {
  owners?: Map<string, { name: string; email: string }>;
}

const NUMBER_FMT = '#,##0.###';
const DATETIME_FMT = 'yyyy-mm-dd hh:mm';
const DATE_FMT = 'yyyy-mm-dd';

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, '');
}

function resolveOptionLabel(rawValue: string, options: { value: string; label: string }[] | undefined): string {
  // Unmapped internal value (or no options at all): fall back to the raw value
  // as text rather than throwing. See FINDINGS.md section 8 - options can be
  // empty, and a whole export must not fail over one stale value.
  const match = options?.find((option) => option.value === rawValue);
  return match ? match.label : rawValue;
}

function mapString(raw: string, def: PropertyDef): MappedCell {
  if (def.fieldType === 'textarea') return { value: raw, wrapText: true };
  if (def.fieldType === 'html') return { value: stripHtmlTags(raw) }; // DECISION 1
  return { value: raw };
}

function mapEnumeration(raw: string, def: PropertyDef): MappedCell {
  if (def.fieldType === 'booleancheckbox') {
    // DECISION 2: a real Excel boolean, not the option label text.
    return { value: raw === 'true' };
  }
  if (def.fieldType === 'checkbox') {
    // Multi-select: ";"-separated internal values, each resolved to its label,
    // joined with ", ".
    const labels = raw.split(';').map((part) => resolveOptionLabel(part, def.options));
    return { value: labels.join(', ') };
  }
  // select, radio, calculation_rollup, and any other enumeration fieldType:
  // internal value -> label.
  return { value: resolveOptionLabel(raw, def.options) };
}

function parseFiniteNumber(raw: string): number | null {
  // parseFloat('') / parseFloat('n/a') / parseFloat('   ') all return NaN, and
  // a divide-by-zero property could yield Infinity. Neither is a legal cell
  // value (spec section 1, invariant 4: no cell contains NaN) - empty cell.
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseValidDate(raw: string): Date | null {
  // new Date('') / new Date('not-a-date') / new Date('2026-13-45') all return
  // an Invalid Date. Writing that to a cell breaks the file (spec section 1,
  // invariant 5: must open without a repair prompt) - empty cell instead.
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function mapByType(raw: string, def: PropertyDef): MappedCell {
  switch (def.type) {
    case 'string':
    case 'phone_number':
      // Never numeric - leading zeros and "+" matter (phonenumber fieldType).
      return mapString(raw, def);

    case 'number': {
      // calculation_* fieldTypes are read-only computed numbers; they export
      // the same way as a plain number.
      const value = parseFiniteNumber(raw);
      return value === null ? { value: null } : { value, numFmt: NUMBER_FMT };
    }

    case 'datetime': {
      // fieldType is irrelevant here (date or any calculation_*): a datetime
      // keeps its time-of-day, unlike the date-only case below.
      const value = parseValidDate(raw);
      return value === null ? { value: null } : { value, numFmt: DATETIME_FMT };
    }

    case 'date': {
      const value = parseValidDate(raw);
      return value === null ? { value: null } : { value, numFmt: DATE_FMT };
    }

    case 'bool':
      return { value: raw === 'true' };

    case 'enumeration':
      return mapEnumeration(raw, def);

    case 'object_coordinates':
      // DECISION 3: text fallback, no special case - these are internal
      // pointers with no user-readable value.
      return { value: raw };

    default:
      // Unknown or unmapped type: text, never throw. A new HubSpot property
      // type must never break an export.
      return { value: raw };
  }
}

export function mapCell(raw: unknown, def: PropertyDef, ctx?: MapCellContext): MappedCell {
  // Empty values are null, never absent (FINDINGS.md section 4).
  if (raw === null || raw === undefined) return { value: null };

  const rawValue = String(raw);

  // 1. referencedObjectType, checked before the type/fieldType table.
  if (def.referencedObjectType) {
    if (def.referencedObjectType === 'OWNER') {
      const owner = ctx?.owners?.get(rawValue);
      if (owner) return { value: owner.name };
    }
    // OWNER without a cache hit, and every other referencedObjectType:
    // identifiers are always text, unresolved.
    return { value: rawValue };
  }

  // 2. type/fieldType table.
  return mapByType(rawValue, def);
}
