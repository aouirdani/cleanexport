import { describe, it, expect } from 'vitest';
import { mapCell, columnValueType, columnWrapsText, type PropertyDef, type MappedCell } from '@/lib/export/typeMap';

// Rules under test (specs/05-EXPORT-ENGINE.md sections 4.0 and 4; ground truth
// observed values from recon/FINDINGS.md sections 3, 7, 8 - FINDINGS wins on conflict):
//
//   Dispatch order (section 4.0): def.referencedObjectType is checked BEFORE the
//   type/fieldType table. OWNER resolves via the optional ctx.owners Map, keyed by
//   the owner's `id` field as a STRING (FINDINGS.md section 6: id is a string,
//   userId is a number - matching on userId is wrong). Without ctx, or when the id
//   is absent from the map, OWNER falls back to the raw id as unresolved text
//   rather than throwing. Every other referencedObjectType always stays text.
//
//   type decides value semantics; fieldType only decides wrapText / multi-select
//   detection (section 4, and FINDINGS section 7 "the rule this inventory establishes").
//
//   Every raw value arrives as string | null, including numbers (FINDINGS section 3).
//   mapCell parses, it does not merely format.

function expectCell(
  result: MappedCell,
  expected: { value: MappedCell['value']; numFmt?: string; wrapText?: boolean },
) {
  if (expected.value instanceof Date) {
    expect(result.value).toBeInstanceOf(Date);
    expect((result.value as Date).getTime()).toBe(expected.value.getTime());
  } else {
    expect(result.value).toBe(expected.value);
  }
  expect(result.numFmt).toBe(expected.numFmt);
  expect(result.wrapText).toBe(expected.wrapText);
}

const NUMBER_FMT = '#,##0.###';
const CURRENCY_NUMBER_FMT = '#,##0.00';
const DATETIME_FMT = 'yyyy-mm-dd hh:mm';
const DATE_FMT = 'yyyy-mm-dd';

describe('mapCell - trap A: referencedObjectType is checked before the type/fieldType table', () => {
  // FINDINGS.md section 8 / spec section 4.0 say OWNER "resolves via an owners
  // cache" while every other referencedObjectType stays unresolved text. mapCell's
  // third parameter, ctx.owners, is that cache: a Map keyed by the owner's `id`
  // field as a STRING (FINDINGS.md section 6 - id is a string, userId is a number;
  // matching on userId would silently never resolve anything). Without ctx, or
  // with ctx but no matching id in the map, OWNER falls back to the raw id as
  // unresolved text rather than throwing. Every other referencedObjectType always
  // stays unresolved text regardless of ctx.

  it('hubspot_owner_id without ctx (enumeration/select, EMPTY options, referencedObjectType OWNER) stays unresolved text', () => {
    const def: PropertyDef = {
      name: 'hubspot_owner_id',
      label: 'Owner',
      type: 'enumeration',
      fieldType: 'select',
      options: [],
      referencedObjectType: 'OWNER',
    };
    // naive enumeration handling against an empty options array is exactly the
    // failure mode section 4.0 warns about - it must not throw either.
    expect(() => mapCell('96879917', def)).not.toThrow();
    const result = mapCell('96879917', def);
    expectCell(result, { value: '96879917' });
    expect(typeof result.value).toBe('string');
  });

  it('hubspot_owner_id with a populated ctx.owners Map resolves to "Firstname Lastname"', () => {
    const def: PropertyDef = {
      name: 'hubspot_owner_id',
      label: 'Owner',
      type: 'enumeration',
      fieldType: 'select',
      options: [],
      referencedObjectType: 'OWNER',
    };
    // keyed by id (string), per FINDINGS.md section 6 - not userId (number).
    const owners = new Map([['96879917', { name: 'Aymane Ouirdani', email: 'aymane@example.com' }]]);
    const result = mapCell('96879917', def, { owners });
    expectCell(result, { value: 'Aymane Ouirdani' });
  });

  it('hubspot_owner_id with ctx.owners provided but the id absent from the Map falls back to raw text, never throws', () => {
    const def: PropertyDef = {
      name: 'hubspot_owner_id',
      label: 'Owner',
      type: 'enumeration',
      fieldType: 'select',
      options: [],
      referencedObjectType: 'OWNER',
    };
    const owners = new Map([['11111111', { name: 'Someone Else', email: 'someone@example.com' }]]);
    expect(() => mapCell('96879917', def, { owners })).not.toThrow();
    const result = mapCell('96879917', def, { owners });
    expectCell(result, { value: '96879917' });
  });

  it('associatedcompanyid (number/number, referencedObjectType COMPANY) stays text, not a formatted number', () => {
    const def: PropertyDef = {
      name: 'associatedcompanyid',
      label: 'Company',
      type: 'number',
      fieldType: 'number',
      referencedObjectType: 'COMPANY',
    };
    const result = mapCell('442222359747', def);
    expectCell(result, { value: '442222359747' });
    expect(typeof result.value).toBe('string');
  });

  it('an id longer than 15 significant digits is preserved exactly because it is never parsed as a number', () => {
    // Excel/IEEE-754 doubles keep only 15 significant digits. If this were parsed
    // as a number it would be silently rounded into a DIFFERENT id.
    const def: PropertyDef = {
      name: 'associatedcompanyid',
      label: 'Company',
      type: 'number',
      fieldType: 'number',
      referencedObjectType: 'COMPANY',
    };
    const longId = '1234567890123456'; // 16 digits
    const result = mapCell(longId, def);
    expect(result.value).toBe(longId);
  });

  it('a 17-digit id is preserved exactly - unlike the 16-digit case above, this one is UNAMBIGUOUSLY beyond Number.MAX_SAFE_INTEGER (2^53, 16 digits), so parsing it as a number is guaranteed lossy, not just theoretically risky', () => {
    const def: PropertyDef = {
      name: 'associatedcompanyid',
      label: 'Company',
      type: 'number',
      fieldType: 'number',
      referencedObjectType: 'COMPANY',
    };
    const longId = '12345678901234567'; // 17 digits
    expect(longId.length).toBeGreaterThan(String(Number.MAX_SAFE_INTEGER).length);
    const result = mapCell(longId, def);
    expect(result.value).toBe(longId);
    expect(typeof result.value).toBe('string');
  });

  it('hs_latest_sequence_enrolled (number/number, referencedObjectType SEQUENCE) stays text', () => {
    const def: PropertyDef = {
      name: 'hs_latest_sequence_enrolled',
      label: 'Latest sequence enrolled',
      type: 'number',
      fieldType: 'number',
      referencedObjectType: 'SEQUENCE',
    };
    const result = mapCell('987654321', def);
    expectCell(result, { value: '987654321' });
  });

  it('any other referencedObjectType (not just the two observed) also stays unresolved text', () => {
    const def: PropertyDef = {
      name: 'associateddealid',
      label: 'Deal',
      type: 'number',
      fieldType: 'number',
      referencedObjectType: 'DEAL',
    };
    const result = mapCell('55555', def);
    expectCell(result, { value: '55555' });
  });

  it('contrast: the identical number/number definition WITHOUT referencedObjectType parses as a real number', () => {
    // Proves referencedObjectType is what flips the behaviour - the type/fieldType
    // table alone would have produced a number either way.
    const def: PropertyDef = {
      name: 'some_other_number_property',
      label: 'Some Number',
      type: 'number',
      fieldType: 'number',
    };
    const result = mapCell('442222359747', def);
    expectCell(result, { value: 442222359747, numFmt: NUMBER_FMT });
    expect(typeof result.value).toBe('number');
  });
});

// hs_object_id is NOT a referencedObjectType property - it is the record's
// OWN id, not a foreign-key pointer to another object - so trap A's guard
// above (which only fires on referencedObjectType) does not cover it at
// all. HubSpot's own property definition for hs_object_id declares it
// `type: "number"` (confirmed via recon/sample-records.json: real ids like
// "840926056668" arrive as plain numeric-looking strings, same shape as
// associatedcompanyid before that property was known to need the
// referencedObjectType guard). Excel/IEEE-754 doubles only keep 15-16
// significant digits (2^53) - the exact same corruption trap FINDINGS.md
// section 8 documents for associatedcompanyid applies equally to
// hs_object_id. Fixed by `looksLikeIdentifierName` in lib/export/typeMap.ts:
// hs_object_id ends in `_id`, so it is caught by name, not by a hardcoded
// check for this specific property.
describe('mapCell - hs_object_id: the record\'s own id, not a referencedObjectType property', () => {
  it('a realistic (12-digit, in-range) hs_object_id round-trips fine today - this alone would not catch the defect', () => {
    const def: PropertyDef = { name: 'hs_object_id', label: 'Record ID', type: 'number', fieldType: 'number' };
    const result = mapCell('840926056668', def);
    expect(String(result.value)).toBe('840926056668');
  });

  it('a 17-digit hs_object_id must be preserved exactly as text, not silently rounded into a different id by IEEE-754 double precision', () => {
    const def: PropertyDef = { name: 'hs_object_id', label: 'Record ID', type: 'number', fieldType: 'number' };
    const longId = '12345678901234567'; // 17 digits, unambiguously beyond safe integer precision
    const result = mapCell(longId, def);
    expect(result.value).toBe(longId);
    expect(typeof result.value).toBe('string');
  });

  it('a real Excel date/number column for hs_object_id round-trips as ExcelJS.ValueType.String, not Number, at the full writer boundary', () => {
    // Sanity check that the name-based rule also fixes columnValueType/
    // columnWrapsText, not just mapCell - covered end-to-end (real file) in
    // tests/export/writer.test.ts's "long ids never get silently rounded"
    // describe block.
    const def: PropertyDef = { name: 'hs_object_id', label: 'Record ID', type: 'number', fieldType: 'number' };
    expect(columnValueType(def)).toBe('text');
    expect(columnWrapsText(def)).toBe(false);
  });
});

// The rule is NOT "hs_object_id specifically" - it is "any property whose
// name says it's an identifier, regardless of declared type." These cases
// prove the rule is general (covers other id-shaped names named in the
// same finding, and any future custom property following the same
// convention) AND narrow (an ordinary word that merely ends in the two
// letters "id" is not a false positive).
describe('mapCell - looksLikeIdentifierName generalises beyond hs_object_id (recon/FINDINGS.md section 8 addendum)', () => {
  it('hs_unique_creation_key (ends in _key, not _id) is also forced to text', () => {
    const def: PropertyDef = { name: 'hs_unique_creation_key', label: 'Unique creation key', type: 'number', fieldType: 'number' };
    const longId = '12345678901234567'; // 17 digits
    const result = mapCell(longId, def);
    expect(result.value).toBe(longId);
    expect(typeof result.value).toBe('string');
  });

  it('any custom property a portal names with an "_id" suffix is covered automatically, with no change to this file', () => {
    const def: PropertyDef = { name: 'external_id', label: 'External ID', type: 'number', fieldType: 'number' };
    const longId = '98765432109876543'; // 17 digits
    const result = mapCell(longId, def);
    expect(result.value).toBe(longId);
    expect(typeof result.value).toBe('string');
  });

  it('does NOT false-positive on ordinary words that merely end in the letters "id" (valid, paid) - the suffix must include the underscore', () => {
    const validDef: PropertyDef = { name: 'valid', label: 'Valid', type: 'number', fieldType: 'number' };
    const paidDef: PropertyDef = { name: 'amountpaid', label: 'Amount Paid', type: 'number', fieldType: 'number' };
    expect(mapCell('442222359747', validDef).value).toBe(442222359747);
    expect(typeof mapCell('442222359747', validDef).value).toBe('number');
    expect(mapCell('442222359747', paidDef).value).toBe(442222359747);
    expect(typeof mapCell('442222359747', paidDef).value).toBe('number');
  });

  it('a legacy id-shaped property with no underscore (associatedcompanyid-style) is still covered, but only because of referencedObjectType, not the name pattern - the name check alone would miss it', () => {
    // This is exactly why trap A's referencedObjectType guard is checked
    // FIRST and kept as-is, not replaced by the name pattern: HubSpot's own
    // pre-"_id"-convention property names (associatedcompanyid,
    // associateddealid) don't end in "_id" and would slip through the name
    // check alone.
    const def: PropertyDef = { name: 'associatedcompanyid', label: 'Company', type: 'number', fieldType: 'number' };
    expect(/_id$|_key$/.test(def.name)).toBe(false);
    const result = mapCell('442222359747', def);
    expect(typeof result.value).toBe('number'); // NOT text - proves the name pattern alone doesn't catch this one
  });
});

describe('mapCell - trap B: type decides value semantics, fieldType does not', () => {
  it('datetime/date parses to a real Date and keeps a time-aware numFmt', () => {
    const def: PropertyDef = { name: 'lastmodifieddate', label: 'Last Modified', type: 'datetime', fieldType: 'date' };
    const result = mapCell('2026-08-09T22:22:08.804Z', def);
    expectCell(result, { value: new Date('2026-08-09T22:22:08.804Z'), numFmt: DATETIME_FMT });
  });

  it('date/date parses to a real Date with a date-only numFmt', () => {
    const def: PropertyDef = { name: 'date_of_birth', label: 'Date of Birth', type: 'date', fieldType: 'date' };
    const result = mapCell('2026-03-15T00:00:00.000Z', def);
    expectCell(result, { value: new Date('2026-03-15T00:00:00.000Z'), numFmt: DATE_FMT });
  });

  it('the trap itself: identical fieldType "date", different declared type -> different numFmt', () => {
    const raw = '2026-08-09T14:30:00.000Z';
    const datetimeDef: PropertyDef = { name: 'a', label: 'A', type: 'datetime', fieldType: 'date' };
    const dateDef: PropertyDef = { name: 'b', label: 'B', type: 'date', fieldType: 'date' };

    const datetimeResult = mapCell(raw, datetimeDef);
    const dateResult = mapCell(raw, dateDef);

    expect(datetimeResult.numFmt).toBe(DATETIME_FMT);
    expect(dateResult.numFmt).toBe(DATE_FMT);
    expect(datetimeResult.numFmt).not.toBe(dateResult.numFmt);
    // keying on fieldType alone (both are "date") would have produced identical
    // output for both defs - it must not.
  });

  it('datetime/calculation_rollup still parses to a Date, even though fieldType is not "date"', () => {
    const def: PropertyDef = { name: 'hs_computed_datetime', label: 'Computed', type: 'datetime', fieldType: 'calculation_rollup' };
    const result = mapCell('2026-01-01T09:00:00.000Z', def);
    expectCell(result, { value: new Date('2026-01-01T09:00:00.000Z'), numFmt: DATETIME_FMT });
  });
});

describe('mapCell - trap C: raw values arrive as string | null and must be parsed, not merely formatted', () => {
  it('a numeric string is parsed into a real number', () => {
    const def: PropertyDef = { name: 'amount', label: 'Amount', type: 'number', fieldType: 'number' };
    const result = mapCell('1234.56', def);
    expect(result.value).toBe(1234.56);
    expect(typeof result.value).toBe('number');
  });

  it('a boolean string is parsed into a real boolean, not left as the string "true"', () => {
    const def: PropertyDef = { name: 'flag', label: 'Flag', type: 'bool', fieldType: 'booleancheckbox' };
    const result = mapCell('true', def);
    expect(result.value).toBe(true);
    expect(typeof result.value).toBe('boolean');
  });

  it('a date string is parsed into a real Date instance, not left as text', () => {
    const def: PropertyDef = { name: 'createdate', label: 'Create Date', type: 'datetime', fieldType: 'date' };
    const result = mapCell('2026-08-09T00:01:08.512Z', def);
    expect(result.value).toBeInstanceOf(Date);
  });

  it('DECISION 2: enumeration/booleancheckbox parses to a real boolean, not the label string "True"', () => {
    const def: PropertyDef = {
      name: 'currentlyinworkflow',
      label: 'Currently In Workflow',
      type: 'enumeration',
      fieldType: 'booleancheckbox',
      options: [
        { value: 'true', label: 'True' },
        { value: 'false', label: 'False' },
      ],
    };
    const result = mapCell('true', def);
    expect(result.value).toBe(true);
    expect(typeof result.value).toBe('boolean');
  });
});

describe('mapCell - unparseable numbers and dates become an empty cell, never NaN or Invalid Date', () => {
  // specs/05-EXPORT-ENGINE.md section 1: invariant 4 forbids NaN in a cell;
  // invariant 5 requires the file to open without a repair prompt, which an
  // Invalid Date would break.
  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['non-numeric text', 'n/a'],
    ['non-numeric text', 'abc'],
  ])('number/number with unparseable raw "%s" -> empty cell, never NaN', (_label, raw) => {
    const def: PropertyDef = { name: 'amount', label: 'Amount', type: 'number', fieldType: 'number' };
    const result = mapCell(raw, def);
    expect(result.value).toBeNull();
    expect(result.value).not.toBeNaN();
  });

  it('number/number with a valid raw value still parses (the guard does not swallow good data)', () => {
    const def: PropertyDef = { name: 'amount', label: 'Amount', type: 'number', fieldType: 'number' };
    const result = mapCell('1234.56', def);
    expect(result.value).toBe(1234.56);
    expect(result.numFmt).toBe(NUMBER_FMT);
  });

  it.each([
    ['empty string', ''],
    ['unparseable text', 'not-a-date'],
    ['out-of-range calendar date', '2026-13-45'],
  ])('datetime/date with unparseable raw "%s" -> empty cell, never an Invalid Date', (_label, raw) => {
    const def: PropertyDef = { name: 'lastmodifieddate', label: 'Last Modified', type: 'datetime', fieldType: 'date' };
    const result = mapCell(raw, def);
    expect(result.value).toBeNull();
  });

  it('datetime/date with a valid raw value still parses (the guard does not swallow good data)', () => {
    const def: PropertyDef = { name: 'lastmodifieddate', label: 'Last Modified', type: 'datetime', fieldType: 'date' };
    const result = mapCell('2026-08-09T22:22:08.804Z', def);
    expectCell(result, { value: new Date('2026-08-09T22:22:08.804Z'), numFmt: DATETIME_FMT });
  });

  it.each([
    ['empty string', ''],
    ['unparseable text', 'not-a-date'],
    ['out-of-range calendar date', '2026-13-45'],
  ])('date/date with unparseable raw "%s" -> empty cell, never an Invalid Date', (_label, raw) => {
    const def: PropertyDef = { name: 'date_of_birth', label: 'Date of Birth', type: 'date', fieldType: 'date' };
    const result = mapCell(raw, def);
    expect(result.value).toBeNull();
  });

  it('date/date with a valid raw value still parses (the guard does not swallow good data)', () => {
    const def: PropertyDef = { name: 'date_of_birth', label: 'Date of Birth', type: 'date', fieldType: 'date' };
    const result = mapCell('2026-03-15T00:00:00.000Z', def);
    expectCell(result, { value: new Date('2026-03-15T00:00:00.000Z'), numFmt: DATE_FMT });
  });
});

describe('mapCell - showCurrencySymbol (FINDINGS.md section 13: currency is per record, not per portal)', () => {
  it('amount with showCurrencySymbol true gets the currency numFmt, not the plain number numFmt', () => {
    const def: PropertyDef = {
      name: 'amount',
      label: 'Amount',
      type: 'number',
      fieldType: 'number',
      showCurrencySymbol: true,
      currencyPropertyName: 'deal_currency_code',
    };
    const result = mapCell('1234.5', def);
    expect(result.value).toBe(1234.5);
    expect(result.numFmt).toBe(CURRENCY_NUMBER_FMT);
    // numFmt is per column; currency is per record. No symbol belongs here -
    // a column-level symbol would mislabel the moment an export mixes
    // currencies (e.g. one EUR deal and one USD deal).
    expect(result.numFmt).not.toMatch(/[$€£¥]/);
  });

  it('a plain number without the flag keeps the ordinary numFmt', () => {
    const def: PropertyDef = { name: 'num_children', label: 'Children', type: 'number', fieldType: 'number' };
    const result = mapCell('3', def);
    expect(result.value).toBe(3);
    expect(result.numFmt).toBe(NUMBER_FMT);
  });

  it('an empty string with showCurrencySymbol true still yields an empty cell, not NaN', () => {
    const def: PropertyDef = {
      name: 'amount',
      label: 'Amount',
      type: 'number',
      fieldType: 'number',
      showCurrencySymbol: true,
      currencyPropertyName: 'deal_currency_code',
    };
    const result = mapCell('', def);
    expect(result.value).toBeNull();
    expect(result.value).not.toBeNaN();
    expect(result.numFmt).toBeUndefined();
  });
});

describe('mapCell - FINDINGS.md section 7 inventory (contacts, exhaustive)', () => {
  it('string/text -> Text', () => {
    const def: PropertyDef = { name: 'firstname', label: 'First Name', type: 'string', fieldType: 'text' };
    expectCell(mapCell('Brian', def), { value: 'Brian' });
  });

  it('string/textarea -> Text, wrapText', () => {
    const def: PropertyDef = { name: 'message', label: 'Message', type: 'string', fieldType: 'textarea' };
    expectCell(mapCell('Line one', def), { value: 'Line one', wrapText: true });
  });

  it('string/phonenumber -> Text, leading zeros preserved, never numeric', () => {
    const def: PropertyDef = { name: 'mobilephone', label: 'Mobile Phone', type: 'string', fieldType: 'phonenumber' };
    const result = mapCell('0102030405', def);
    expectCell(result, { value: '0102030405' });
    expect(typeof result.value).toBe('string');
  });

  it('string/html -> tags stripped to plain text (DECISION 1)', () => {
    const def: PropertyDef = { name: 'hs_chat_assistant_summary', label: 'Chat Assistant: Summary', type: 'string', fieldType: 'html' };
    expectCell(mapCell('<p>Hello <b>World</b></p>', def), { value: 'Hello World' });
  });

  it.each([
    ['calculation_rollup', 'calculation_rollup'],
    ['calculation_equation', 'calculation_equation'],
  ])('string/%s -> Text', (_label, fieldType) => {
    const def: PropertyDef = { name: 'computed_string', label: 'Computed', type: 'string', fieldType };
    expectCell(mapCell('computed value', def), { value: 'computed value' });
  });

  it('phone_number/phonenumber -> Text', () => {
    const def: PropertyDef = { name: 'phone', label: 'Phone', type: 'phone_number', fieldType: 'phonenumber' };
    const result = mapCell('+33102030405', def);
    expectCell(result, { value: '+33102030405' });
    expect(typeof result.value).toBe('string');
  });

  it('number/number -> parseFloat -> number', () => {
    const def: PropertyDef = { name: 'num_children', label: 'Children', type: 'number', fieldType: 'number' };
    expectCell(mapCell('3', def), { value: 3, numFmt: NUMBER_FMT });
  });

  it.each([
    ['calculation_rollup', 'calculation_rollup'],
    ['calculation_equation', 'calculation_equation'],
    ['calculation_score', 'calculation_score'],
    ['calculation_read_time', 'calculation_read_time'],
  ])('number/%s -> parseFloat -> number (full calculation_* family)', (_label, fieldType) => {
    const def: PropertyDef = { name: 'computed_number', label: 'Computed', type: 'number', fieldType };
    expectCell(mapCell('42.5', def), { value: 42.5, numFmt: NUMBER_FMT });
  });

  it('datetime/date -> parse -> Date', () => {
    const def: PropertyDef = { name: 'createdate', label: 'Create Date', type: 'datetime', fieldType: 'date' };
    expectCell(mapCell('2026-08-09T00:01:08.512Z', def), {
      value: new Date('2026-08-09T00:01:08.512Z'),
      numFmt: DATETIME_FMT,
    });
  });

  it.each([
    ['calculation_rollup', 'calculation_rollup'],
    ['calculation_equation', 'calculation_equation'],
  ])('datetime/%s -> parse -> Date', (_label, fieldType) => {
    const def: PropertyDef = { name: 'computed_datetime', label: 'Computed', type: 'datetime', fieldType };
    expectCell(mapCell('2026-05-05T12:00:00.000Z', def), {
      value: new Date('2026-05-05T12:00:00.000Z'),
      numFmt: DATETIME_FMT,
    });
  });

  it('date/date -> parse -> Date', () => {
    const def: PropertyDef = { name: 'date_of_birth', label: 'Date of Birth', type: 'date', fieldType: 'date' };
    expectCell(mapCell('2026-03-15T00:00:00.000Z', def), {
      value: new Date('2026-03-15T00:00:00.000Z'),
      numFmt: DATE_FMT,
    });
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('bool/booleancheckbox "%s" -> boolean', (raw, expected) => {
    const def: PropertyDef = { name: 'is_active', label: 'Active', type: 'bool', fieldType: 'booleancheckbox' };
    expectCell(mapCell(raw, def), { value: expected });
  });

  it.each([
    ['calculation_equation', 'calculation_equation'],
    ['calculation_read_time', 'calculation_read_time'],
  ])('bool/%s -> boolean', (_label, fieldType) => {
    const def: PropertyDef = { name: 'computed_bool', label: 'Computed', type: 'bool', fieldType };
    expectCell(mapCell('true', def), { value: true });
  });

  it('enumeration/select -> internal value resolved to its label', () => {
    const def: PropertyDef = {
      name: 'lifecyclestage',
      label: 'Lifecycle Stage',
      type: 'enumeration',
      fieldType: 'select',
      options: [
        { value: 'lead', label: 'Lead' },
        { value: 'customer', label: 'Customer' },
      ],
    };
    expectCell(mapCell('customer', def), { value: 'Customer' });
  });

  it('enumeration/checkbox -> multi-select, ";"-separated, mapped and joined with ", "', () => {
    const def: PropertyDef = {
      name: 'interests',
      label: 'Interests',
      type: 'enumeration',
      fieldType: 'checkbox',
      options: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
        { value: 'c', label: 'Gamma' },
      ],
    };
    expectCell(mapCell('a;b;c', def), { value: 'Alpha, Beta, Gamma' });
  });

  it('enumeration/checkbox with a single selected value -> single label, no separator', () => {
    const def: PropertyDef = {
      name: 'interests',
      label: 'Interests',
      type: 'enumeration',
      fieldType: 'checkbox',
      options: [{ value: 'a', label: 'Alpha' }],
    };
    expectCell(mapCell('a', def), { value: 'Alpha' });
  });

  it('enumeration/radio -> internal value resolved to its label', () => {
    const def: PropertyDef = {
      name: 'preferred_contact_method',
      label: 'Preferred Contact Method',
      type: 'enumeration',
      fieldType: 'radio',
      options: [
        { value: 'email', label: 'Email' },
        { value: 'phone', label: 'Phone' },
      ],
    };
    expectCell(mapCell('email', def), { value: 'Email' });
  });

  it('enumeration/booleancheckbox -> real boolean (DECISION 2), not the label text', () => {
    const def: PropertyDef = {
      name: 'currentlyinworkflow',
      label: 'Currently In Workflow',
      type: 'enumeration',
      fieldType: 'booleancheckbox',
      options: [
        { value: 'true', label: 'True' },
        { value: 'false', label: 'False' },
      ],
    };
    expectCell(mapCell('false', def), { value: false });
  });

  it('enumeration/calculation_rollup -> internal value resolved to its label', () => {
    const def: PropertyDef = {
      name: 'computed_enum',
      label: 'Computed',
      type: 'enumeration',
      fieldType: 'calculation_rollup',
      options: [{ value: 'x', label: 'X Label' }],
    };
    expectCell(mapCell('x', def), { value: 'X Label' });
  });

  it('object_coordinates/text -> text fallback (DECISION 3)', () => {
    const def: PropertyDef = { name: 'hs_notes_last_activity', label: 'Last Activity', type: 'object_coordinates', fieldType: 'text' };
    expectCell(mapCell('0-1-840926056668', def), { value: '0-1-840926056668' });
  });
});

describe('mapCell - unmapped enumeration value falls back to the raw text rather than throwing', () => {
  // Not explicitly speced, but consistent with "unknown/unmapped -> text, never
  // throw": an internal value with no matching option must still produce a legal,
  // non-throwing cell rather than null or an exception.
  it('an internal value absent from options is returned as raw text', () => {
    const def: PropertyDef = {
      name: 'lifecyclestage',
      label: 'Lifecycle Stage',
      type: 'enumeration',
      fieldType: 'select',
      options: [{ value: 'lead', label: 'Lead' }],
    };
    expect(() => mapCell('unknown_internal_value', def)).not.toThrow();
    const result = mapCell('unknown_internal_value', def);
    expect(result.value).toBe('unknown_internal_value');
  });
});

describe('mapCell - unknown type falls back to text and never throws', () => {
  it('a type not present in the inventory is treated as text', () => {
    const def: PropertyDef = { name: 'hs_future_property', label: 'Future Property', type: 'some_brand_new_type', fieldType: 'whatever' };
    expect(() => mapCell('anything', def)).not.toThrow();
    expectCell(mapCell('anything', def), { value: 'anything' });
  });

  it('an unknown type never throws even with a value that looks numeric', () => {
    const def: PropertyDef = { name: 'hs_future_property', label: 'Future Property', type: 'some_brand_new_type', fieldType: 'whatever' };
    expect(() => mapCell('12345', def)).not.toThrow();
    expectCell(mapCell('12345', def), { value: '12345' });
  });
});

describe('mapCell - null raw is always an empty cell, regardless of the definition', () => {
  it.each([
    ['string/text', { name: 'firstname', label: 'First Name', type: 'string', fieldType: 'text' } as PropertyDef],
    ['number/number', { name: 'amount', label: 'Amount', type: 'number', fieldType: 'number' } as PropertyDef],
    ['datetime/date', { name: 'createdate', label: 'Create Date', type: 'datetime', fieldType: 'date' } as PropertyDef],
    ['bool/booleancheckbox', { name: 'is_active', label: 'Active', type: 'bool', fieldType: 'booleancheckbox' } as PropertyDef],
    [
      'enumeration/select',
      {
        name: 'lifecyclestage',
        label: 'Lifecycle Stage',
        type: 'enumeration',
        fieldType: 'select',
        options: [{ value: 'lead', label: 'Lead' }],
      } as PropertyDef,
    ],
    [
      'referencedObjectType OWNER',
      { name: 'hubspot_owner_id', label: 'Owner', type: 'enumeration', fieldType: 'select', options: [], referencedObjectType: 'OWNER' } as PropertyDef,
    ],
  ])('%s with null raw -> null value', (_label, def) => {
    expect(mapCell(null, def).value).toBeNull();
  });
});

// columnValueType answers "what kind of value will this column always be",
// without a sample raw value in hand (lib/exportPreview.ts needs this: a
// column's type must be known even when every sampled row is null). It
// reads the same DISPATCH_TABLE mapCell/mapByType do - one table, two
// questions - so these tests both pin its own per-case behaviour AND
// cross-check it against mapCell's REAL runtime output, which is what would
// actually catch the table drifting out from under one of its two readers.
describe('columnValueType - specs/05-EXPORT-ENGINE.md sections 4.0 and 4, restated as a column-level kind', () => {
  it('a referencedObjectType property is always text, even OWNER (resolved or not)', () => {
    const owner: PropertyDef = { name: 'hubspot_owner_id', label: 'Owner', type: 'enumeration', fieldType: 'select', referencedObjectType: 'OWNER' };
    const company: PropertyDef = { name: 'associatedcompanyid', label: 'Company', type: 'number', fieldType: 'number', referencedObjectType: 'COMPANY' };
    expect(columnValueType(owner)).toBe('text');
    expect(columnValueType(company)).toBe('text');
  });

  it('number -> number', () => {
    expect(columnValueType({ name: 'amount', label: 'Amount', type: 'number', fieldType: 'number' })).toBe('number');
  });

  it('datetime -> datetime, date -> date (distinct - a datetime keeps its time-of-day)', () => {
    expect(columnValueType({ name: 'a', label: 'A', type: 'datetime', fieldType: 'date' })).toBe('datetime');
    expect(columnValueType({ name: 'b', label: 'B', type: 'date', fieldType: 'date' })).toBe('date');
  });

  it('bool -> boolean', () => {
    expect(columnValueType({ name: 'flag', label: 'Flag', type: 'bool', fieldType: 'booleancheckbox' })).toBe('boolean');
  });

  it('enumeration/booleancheckbox -> boolean; every other enumeration fieldType -> text', () => {
    expect(columnValueType({ name: 'x', label: 'X', type: 'enumeration', fieldType: 'booleancheckbox' })).toBe('boolean');
    expect(columnValueType({ name: 'x', label: 'X', type: 'enumeration', fieldType: 'select' })).toBe('text');
    expect(columnValueType({ name: 'x', label: 'X', type: 'enumeration', fieldType: 'checkbox' })).toBe('text');
  });

  it('string, phone_number, object_coordinates, and an unmapped type are all text', () => {
    expect(columnValueType({ name: 'a', label: 'A', type: 'string', fieldType: 'text' })).toBe('text');
    expect(columnValueType({ name: 'b', label: 'B', type: 'phone_number', fieldType: 'phonenumber' })).toBe('text');
    expect(columnValueType({ name: 'c', label: 'C', type: 'object_coordinates', fieldType: 'text' })).toBe('text');
    expect(columnValueType({ name: 'd', label: 'D', type: 'brand_new_type', fieldType: 'whatever' })).toBe('text');
  });

  it('an unknown (skipped) property is text', () => {
    expect(columnValueType(undefined)).toBe('text');
  });

  describe('cross-check against mapCell\'s actual runtime output - the drift-detector', () => {
    const CASES: { label: string; def: PropertyDef; raw: string }[] = [
      { label: 'string/text', def: { name: 'firstname', label: 'First Name', type: 'string', fieldType: 'text' }, raw: 'Ada' },
      { label: 'number/number', def: { name: 'amount', label: 'Amount', type: 'number', fieldType: 'number' }, raw: '42' },
      { label: 'datetime/date', def: { name: 'createdate', label: 'Create Date', type: 'datetime', fieldType: 'date' }, raw: '2026-01-01T00:00:00.000Z' },
      { label: 'date/date', def: { name: 'dob', label: 'DOB', type: 'date', fieldType: 'date' }, raw: '2026-01-01T00:00:00.000Z' },
      { label: 'bool/booleancheckbox', def: { name: 'flag', label: 'Flag', type: 'bool', fieldType: 'booleancheckbox' }, raw: 'true' },
      {
        label: 'enumeration/select',
        def: { name: 'stage', label: 'Stage', type: 'enumeration', fieldType: 'select', options: [{ value: 'a', label: 'A' }] },
        raw: 'a',
      },
      {
        label: 'enumeration/booleancheckbox',
        def: { name: 'wf', label: 'WF', type: 'enumeration', fieldType: 'booleancheckbox' },
        raw: 'true',
      },
      { label: 'object_coordinates/text', def: { name: 'oc', label: 'OC', type: 'object_coordinates', fieldType: 'text' }, raw: 'x' },
      {
        label: 'referencedObjectType COMPANY (declared number)',
        def: { name: 'assoccompany', label: 'Company', type: 'number', fieldType: 'number', referencedObjectType: 'COMPANY' },
        raw: '442222359747',
      },
    ];

    it.each(CASES.map(({ label, def, raw }) => [label, def, raw] as const))(
      '%s: columnValueType predicts the actual JS type of mapCell(...).value',
      (_label, def, raw) => {
        const predicted = columnValueType(def);
        const actualValue = mapCell(raw, def).value;

        const typeofToKind = { string: 'text', number: 'number', boolean: 'boolean' } as const;
        const actualKind =
          actualValue instanceof Date ? (def.type === 'datetime' ? 'datetime' : 'date') : typeofToKind[typeof actualValue as 'string' | 'number' | 'boolean'];

        expect(predicted).toBe(actualKind);
      },
    );
  });
});

// Column widths (lib/export/writer.ts): a wrapText column must be widened
// BEFORE any row is written, so this has to be knowable from the PropertyDef
// alone - same shape/reasoning as columnValueType above, mirroring
// mapString's own `fieldType === 'textarea'` check exactly.
describe('columnWrapsText - a property-level answer, no raw value needed (mirrors columnValueType)', () => {
  it('string/textarea wraps; string/text and string/html do not', () => {
    expect(columnWrapsText({ name: 'notes', label: 'Notes', type: 'string', fieldType: 'textarea' })).toBe(true);
    expect(columnWrapsText({ name: 'firstname', label: 'First Name', type: 'string', fieldType: 'text' })).toBe(false);
    expect(columnWrapsText({ name: 'summary', label: 'Summary', type: 'string', fieldType: 'html' })).toBe(false);
  });

  it('a type outside the string/phone_number rule never wraps, even with fieldType "textarea"', () => {
    expect(columnWrapsText({ name: 'a', label: 'A', type: 'number', fieldType: 'textarea' })).toBe(false);
    expect(columnWrapsText({ name: 'b', label: 'B', type: 'enumeration', fieldType: 'textarea' })).toBe(false);
  });

  it('phone_number shares string\'s rule, so it wraps with fieldType "textarea" too (matches mapString\'s own dispatch)', () => {
    expect(columnWrapsText({ name: 'c', label: 'C', type: 'phone_number', fieldType: 'textarea' })).toBe(true);
  });

  it('a referencedObjectType property never wraps, even OWNER', () => {
    const owner: PropertyDef = { name: 'hubspot_owner_id', label: 'Owner', type: 'enumeration', fieldType: 'select', referencedObjectType: 'OWNER' };
    expect(columnWrapsText(owner)).toBe(false);
  });

  it('an unknown (skipped) property never wraps', () => {
    expect(columnWrapsText(undefined)).toBe(false);
  });

  it('cross-check against mapCell\'s actual runtime output: predicts wrapText exactly for a real textarea value', () => {
    const def: PropertyDef = { name: 'message', label: 'Message', type: 'string', fieldType: 'textarea' };
    expect(columnWrapsText(def)).toBe(Boolean(mapCell('line one\nline two', def).wrapText));
  });
});
