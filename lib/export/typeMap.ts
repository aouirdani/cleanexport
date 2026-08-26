/**
 * Cell type mapping - specs/05-EXPORT-ENGINE.md sections 4.0 and 4.
 *
 * Dispatch order, in this exact sequence:
 *   1. referencedObjectType (section 4.0) - a property that references another
 *      object is an identifier, and its declared `type` is misleading. Checked
 *      BEFORE the type/fieldType table below, not as a special case inside it.
 *   1b. name-shaped identifiers with NO referencedObjectType (section 4.0
 *      addendum, recon/FINDINGS.md section 8's second half) - see
 *      `looksLikeIdentifierName` below for why this exists and how it's scoped.
 *   2. a table-driven dispatch on `type` (DISPATCH_TABLE / mapByType) - type
 *      decides value semantics.
 *   3. `fieldType` never drives that dispatch. It only decides wrapText
 *      (mapString) and multi-select splitting (mapEnumeration), inside the
 *      branch that `type` already selected.
 *
 * Every value from HubSpot arrives as string | null (recon/FINDINGS.md section 3).
 * This function parses, it does not merely format.
 *
 * `columnValueType` answers a different, narrower question than `mapCell`:
 * not "what value does this raw string become" but "what KIND of value will
 * this property's column always be" (text/number/date/datetime/boolean) -
 * needed by callers (lib/exportPreview.ts) that show a column's type without
 * necessarily having a sample value in hand. It is deliberately NOT a second,
 * independently-maintained copy of the dispatch table: both it and
 * `mapByType` read `DISPATCH_TABLE`, the one place section 4.0/4's rules are
 * encoded, so a rule added there is automatically correct for both.
 */

export interface PropertyDef {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  options?: { value: string; label: string }[];
  referencedObjectType?: string;
  /** The property is money, not a plain number (FINDINGS.md section 13). */
  showCurrencySymbol?: boolean;
  /**
   * Names ANOTHER property holding this record's currency code. Currency is
   * per record, not per portal - never bake a symbol into numFmt from this
   * (FINDINGS.md section 13: one export can mix EUR and USD deals).
   */
  currencyPropertyName?: string;
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
const CURRENCY_NUMBER_FMT = '#,##0.00';
const DATETIME_FMT = 'yyyy-mm-dd hh:mm';
const DATE_FMT = 'yyyy-mm-dd';

/**
 * `referencedObjectType` (section 4.0) only fires for a property that
 * points at ANOTHER object - it says nothing about a record's OWN id.
 * `hs_object_id` (every object type, always present per FINDINGS.md
 * section 10) has no referencedObjectType at all, yet HubSpot declares
 * it `type: "number"` - the exact same "declared type lies" trap
 * FINDINGS.md section 8 documents for associatedcompanyid, just without
 * the metadata flag that trap relies on to detect it. A 17-digit id
 * parsed as a number is not a theoretical risk: IEEE-754 doubles only
 * keep 15-16 significant digits, so it comes back as a DIFFERENT id
 * (tests/export/typeMap.test.ts proved this concretely before this fix).
 *
 * The rule this function encodes is deliberately NOT "hs_object_id
 * specifically": it's "any property whose OWN NAME says it's an
 * identifier, regardless of what HubSpot's metadata claims its type is."
 * HubSpot's own naming convention is the signal - every identifier or
 * opaque-key property in the inventory this codebase has seen
 * (hs_object_id, hubspot_owner_id, hs_unique_creation_key,
 * hs_latest_sequence_enrolled) ends in `_id` or `_key`. Matching on that
 * suffix, not a fixed name list, means a future object type's own
 * `hs_object_id`, or a custom property a portal names `external_id`,
 * is covered automatically without this file needing to know about it.
 *
 * Deliberately narrow, not a bare `.includes('id')`: a substring match
 * would also catch `valid`, `paid`, `avid` - ordinary words, not
 * identifiers. Requiring the `_id`/`_key` suffix (with the underscore,
 * matching HubSpot's own snake_case convention for every real example
 * seen so far) avoids that false-positive class entirely. The two
 * pre-`_id`-convention legacy names that DON'T end this way
 * (associatedcompanyid, associateddealid) are exactly why the
 * referencedObjectType check above still exists and is checked first -
 * this function is an addition to that trap, not a replacement for it.
 */
function looksLikeIdentifierName(name: string): boolean {
  return /_id$|_key$/.test(name);
}

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

/** What kind of value a property's column always holds - see the file header. */
export type PropertyValueKind = 'text' | 'number' | 'date' | 'datetime' | 'boolean';

interface DispatchRule {
  matches: (def: PropertyDef) => boolean;
  /** A function, not a constant: 'enumeration' resolves to 'boolean' or 'text' depending on fieldType. */
  kind: (def: PropertyDef) => PropertyValueKind;
  produce: (raw: string, def: PropertyDef) => MappedCell;
  /**
   * Whether this property's column ever gets `wrapText` (mapString's own
   * `fieldType === 'textarea'` check) - a property-level trait, not a
   * per-value one, so a caller can widen the column BEFORE it has seen any
   * actual row data. Optional: defaults to never-wraps for every rule that
   * doesn't set it.
   */
  wraps?: (def: PropertyDef) => boolean;
}

/**
 * specs/05-EXPORT-ENGINE.md section 4's table, as data - evaluated top to
 * bottom, first match wins, exactly like the switch statement it replaced.
 * `mapByType` and `columnValueType` are both thin readers of this table, so
 * a new case only needs to be added here once.
 */
const DISPATCH_TABLE: DispatchRule[] = [
  {
    // Never numeric - leading zeros and "+" matter (phonenumber fieldType).
    matches: (def) => def.type === 'string' || def.type === 'phone_number',
    kind: () => 'text',
    produce: mapString,
    // Mirrors mapString's own condition exactly - see columnWrapsText below.
    wraps: (def) => def.fieldType === 'textarea',
  },
  {
    matches: (def) => def.type === 'number',
    kind: () => 'number',
    produce: (raw, def) => {
      // calculation_* fieldTypes are read-only computed numbers; they export
      // the same way as a plain number.
      const value = parseFiniteNumber(raw);
      if (value === null) return { value: null };
      // showCurrencySymbol only changes numFmt (decimals, no literal symbol -
      // the symbol is per record via currencyPropertyName, never baked into a
      // per-column numFmt). The NaN guard above still applies either way.
      const numFmt = def.showCurrencySymbol ? CURRENCY_NUMBER_FMT : NUMBER_FMT;
      return { value, numFmt };
    },
  },
  {
    matches: (def) => def.type === 'datetime',
    kind: () => 'datetime',
    produce: (raw) => {
      // fieldType is irrelevant here (date or any calculation_*): a datetime
      // keeps its time-of-day, unlike the date-only case below.
      const value = parseValidDate(raw);
      return value === null ? { value: null } : { value, numFmt: DATETIME_FMT };
    },
  },
  {
    matches: (def) => def.type === 'date',
    kind: () => 'date',
    produce: (raw) => {
      const value = parseValidDate(raw);
      return value === null ? { value: null } : { value, numFmt: DATE_FMT };
    },
  },
  {
    matches: (def) => def.type === 'bool',
    kind: () => 'boolean',
    produce: (raw) => ({ value: raw === 'true' }),
  },
  {
    matches: (def) => def.type === 'enumeration',
    // DECISION 2: booleancheckbox is a real Excel boolean; every other
    // enumeration fieldType resolves to a label, i.e. text.
    kind: (def) => (def.fieldType === 'booleancheckbox' ? 'boolean' : 'text'),
    produce: mapEnumeration,
  },
  {
    // DECISION 3: text fallback, no special case - these are internal
    // pointers with no user-readable value.
    matches: (def) => def.type === 'object_coordinates',
    kind: () => 'text',
    produce: (raw) => ({ value: raw }),
  },
  {
    // Unknown or unmapped type: text, never throw. A new HubSpot property
    // type must never break an export. Always matches - must stay last.
    matches: () => true,
    kind: () => 'text',
    produce: (raw) => ({ value: raw }),
  },
];

function findRule(def: PropertyDef): DispatchRule {
  // The final rule always matches, so this is never undefined.
  return DISPATCH_TABLE.find((rule) => rule.matches(def))!;
}

function mapByType(raw: string, def: PropertyDef): MappedCell {
  return findRule(def).produce(raw, def);
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

  // 1b. A record's own id (hs_object_id and friends) has no
  // referencedObjectType to catch it - see looksLikeIdentifierName above.
  // Never resolved (there is nothing to resolve it against, unlike OWNER).
  if (looksLikeIdentifierName(def.name)) {
    return { value: rawValue };
  }

  // 2. type/fieldType table.
  return mapByType(rawValue, def);
}

/**
 * The type/fieldType half of `mapCell`'s own dispatch (section 4.0/4),
 * without needing a raw value: `undefined` (property unknown/skipped) and a
 * `referencedObjectType` both mirror mapCell's identical short-circuits
 * before it ever reaches DISPATCH_TABLE.
 */
export function columnValueType(def: PropertyDef | undefined): PropertyValueKind {
  if (!def) return 'text'; // unknown/skipped property - same text fallback as the table's default rule
  if (def.referencedObjectType) return 'text'; // identifiers, incl. a resolved OWNER name, are always text
  if (looksLikeIdentifierName(def.name)) return 'text'; // a record's own id, e.g. hs_object_id - see mapCell's 1b
  return findRule(def).kind(def);
}

/**
 * Same shape as `columnValueType` - a property-level answer, no raw value
 * needed - so lib/export/writer.ts can decide a column's WIDTH before it has
 * written a single row. A `referencedObjectType` property is always plain
 * text (never textarea), so it never wraps either.
 */
export function columnWrapsText(def: PropertyDef | undefined): boolean {
  if (!def) return false;
  if (def.referencedObjectType) return false;
  if (looksLikeIdentifierName(def.name)) return false; // an id never wraps, same reasoning as referencedObjectType
  return findRule(def).wraps?.(def) ?? false;
}
