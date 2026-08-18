import { describe, it, expect } from 'vitest';
import { sanitizeCell, sanitizeRawForCoercion } from '@/lib/export/sanitize';

// Ordered rules under test (specs/05-EXPORT-ENGINE.md section 3):
//   1. null | undefined            -> null (empty cell)
//   2. strip control chars         -> remove U+0000-U+0008, U+000B, U+000C, U+000E-U+001F
//                                      keep U+0009 (tab), U+000A (LF)
//   3. normalise line endings      -> CRLF and lone CR -> LF
//   4. leading = + - @             -> prefix with a single quote
//   5. length > 32767              -> truncate to 32760, append a "[...]" ellipsis suffix
//   6. type coercion                -> out of scope, not tested here
//
// Non-ASCII / control characters are built with String.fromCharCode rather than typed
// literally, so the source file itself stays plain ASCII and unambiguous byte-for-byte.
const NUL = String.fromCharCode(0x00);
const BEL = String.fromCharCode(0x07);
const BS = String.fromCharCode(0x08);
const TAB = String.fromCharCode(0x09);
const LF = String.fromCharCode(0x0a);
const VT = String.fromCharCode(0x0b);
const FF = String.fromCharCode(0x0c);
const CR = String.fromCharCode(0x0d);
const SO = String.fromCharCode(0x0e);
const US = String.fromCharCode(0x1f);
const SPACE = String.fromCharCode(0x20);
const E_ACUTE = String.fromCharCode(0xe9);
const ELLIPSIS = String.fromCharCode(0x2026);
const ELLIPSIS_SUFFIX = SPACE + '[' + ELLIPSIS + ']';

describe('sanitizeCell - rule 1: nullish -> null', () => {
  it.each([
    ['null', null, null],
    ['undefined', undefined, null],
    // boundary: falsy-but-present values must NOT collapse to null
    ['empty string (boundary, not nullish)', '', ''],
  ])('%s', (_label, input, expected) => {
    expect(sanitizeCell(input)).toBe(expected);
  });
});

describe('sanitizeCell - rule 2: strip control characters, keep tab/LF', () => {
  it.each([
    ['NUL U+0000 stripped', 'a' + NUL + 'b', 'ab'],
    ['BEL U+0007 stripped', 'a' + BEL + 'b', 'ab'],
    // boundary: top of the first strip range
    ['BS U+0008 stripped (top of first range)', 'a' + BS + 'b', 'ab'],
    // boundary: immediately above the first strip range - must survive
    ['TAB U+0009 survives (just above first range)', 'a' + TAB + 'b', 'a' + TAB + 'b'],
    ['LF U+000A survives', 'a' + LF + 'b', 'a' + LF + 'b'],
    ['VT U+000B stripped', 'a' + VT + 'b', 'ab'],
    ['FF U+000C stripped', 'a' + FF + 'b', 'ab'],
    // boundary: bottom of the second strip range
    ['SO U+000E stripped (bottom of second range)', 'a' + SO + 'b', 'ab'],
    // boundary: top of the second strip range
    ['US U+001F stripped (top of second range)', 'a' + US + 'b', 'ab'],
    // boundary: immediately above the second strip range - must survive
    ['SPACE U+0020 survives (just above second range)', 'a' + SPACE + 'b', 'a' + SPACE + 'b'],
  ])('%s', (_label, input, expected) => {
    expect(sanitizeCell(input)).toBe(expected);
  });
});

describe('sanitizeCell - rule 3: normalise line endings to LF', () => {
  it.each([
    ['CRLF -> LF', 'a' + CR + LF + 'b', 'a' + LF + 'b'],
    ['lone CR -> LF', 'a' + CR + 'b', 'a' + LF + 'b'],
    ['bare LF is left as-is', 'a' + LF + 'b', 'a' + LF + 'b'],
    ['mixed CRLF and bare LF in one value', 'a' + CR + LF + 'b' + LF + 'c', 'a' + LF + 'b' + LF + 'c'],
    ['mixed CRLF and lone CR in one value', 'a' + CR + LF + 'b' + CR + 'c', 'a' + LF + 'b' + LF + 'c'],
  ])('%s', (_label, input, expected) => {
    expect(sanitizeCell(input)).toBe(expected);
  });

  it('preserves the real multi-line fixture from recon/FINDINGS.md section 9', () => {
    // three lines, joined by bare LF only (no CR) - see FINDINGS.md section 9
    const raw =
      'Premi' + E_ACUTE + 're ligne' + LF +
      'Deuxi' + E_ACUTE + 'me ligne' + LF +
      'Troisi' + E_ACUTE + 'me ligne';
    const result = sanitizeCell(raw);
    expect(result).toBe(raw);
    expect((result as string).split(LF)).toHaveLength(3);
  });
});

describe('sanitizeCell - rule 4: leading = + - @ prefixed with a single quote', () => {
  it.each([
    ['leading = (formula)', '=SUM(1,1)', "'=SUM(1,1)"],
    ['leading +', '+1234', "'+1234"],
    ['leading -', '-5', "'-5"],
    ['leading @', '@mention', "'@mention"],
    // boundary: the trigger character is the entire string
    ['single-character "="', '=', "'="],
  ])('%s', (_label, input, expected) => {
    expect(sanitizeCell(input)).toBe(expected);
  });

  it.each([
    ['= not at position 0', 'abc=1', 'abc=1'],
    ['digit-leading value with + later', '5+5', '5+5'],
    ['whitespace before the trigger char is not itself a trigger', SPACE + '=SUM(1,1)', SPACE + '=SUM(1,1)'],
  ])('does not prefix: %s', (_label, input, expected) => {
    expect(sanitizeCell(input)).toBe(expected);
  });
});

describe('sanitizeCell - rule 5: truncate values longer than 32767 chars', () => {
  it('leaves a 32760-char value untouched (well under the limit)', () => {
    const raw = 'x'.repeat(32760);
    expect(sanitizeCell(raw)).toBe(raw);
  });

  it('leaves a 32761-char value untouched (still under the limit)', () => {
    const raw = 'x'.repeat(32761);
    expect(sanitizeCell(raw)).toBe(raw);
  });

  it('leaves exactly 32767 chars untouched (boundary: at the limit, not over)', () => {
    const raw = 'x'.repeat(32767);
    expect(sanitizeCell(raw)).toBe(raw);
  });

  it('truncates a 32768-char value (boundary: one over the limit)', () => {
    const raw = 'x'.repeat(32768);
    const expected = 'x'.repeat(32760) + ELLIPSIS_SUFFIX;
    const result = sanitizeCell(raw) as string;
    expect(result).toBe(expected);
    expect(result.length).toBe(32764);
  });

  it('truncates a much longer value the same way', () => {
    const raw = 'y'.repeat(100_000);
    const expected = 'y'.repeat(32760) + ELLIPSIS_SUFFIX;
    expect(sanitizeCell(raw)).toBe(expected);
  });
});

describe('sanitizeCell - rule ordering across multiple rules', () => {
  it('strips control chars before evaluating the leading-character injection check', () => {
    // a stripped control char at position 0 exposes "=" as the new leading char
    expect(sanitizeCell(BEL + '=SUM(1,1)')).toBe("'=SUM(1,1)");
  });

  it('normalises line endings before the injection prefix check', () => {
    // the injection check only inspects position 0 of the WHOLE value, so a "=" that
    // starts the second line (after a CR->LF normalised break) is not a leading character
    expect(sanitizeCell('a' + CR + '=cmd')).toBe('a' + LF + '=cmd');
  });

  it('applies the injection prefix before truncation, so the quote counts toward length', () => {
    const raw = '=' + 'x'.repeat(32767);
    const result = sanitizeCell(raw) as string;
    expect(result.startsWith("'=")).toBe(true);
    expect(result.endsWith(ELLIPSIS_SUFFIX)).toBe(true);
    expect(result.length).toBe(32764);
  });

  it('the dangerous case: exactly 32767 chars starting with "=" is only over the limit AFTER quoting', () => {
    // raw is exactly at Excel's limit (32767) and, on its own, rule 5 would leave it
    // untouched. But rule 4 runs first and prepends a quote, making it 32768 -
    // one over the limit - so rule 5 must still catch it on this pass.
    const raw = '=' + 'x'.repeat(32766);
    expect(raw.length).toBe(32767);
    const result = sanitizeCell(raw) as string;
    expect(result.length).toBeLessThanOrEqual(32767);
    expect(result.length).toBe(32764);
    expect(result.startsWith("'=")).toBe(true);
    expect(result.endsWith(ELLIPSIS_SUFFIX)).toBe(true);
  });
});

describe('sanitizeCell - empty string vs null are distinct empty-cell representations', () => {
  it('empty string stays the empty string, it is not collapsed to null', () => {
    // The writer renders both '' and null as an empty cell (recon/FINDINGS.md section 4:
    // HubSpot itself never omits a key, it sends null for "no value" - sanitizeCell keeps
    // '' and null as two distinct inputs rather than folding one into the other).
    expect(sanitizeCell('')).toBe('');
    expect(sanitizeCell('')).not.toBeNull();
  });

  it('null stays null, it is not coerced to the empty string', () => {
    expect(sanitizeCell(null)).toBeNull();
    expect(sanitizeCell(null)).not.toBe('');
  });
});

describe('sanitizeCell - non-string inputs (rule 1 boundary, unknown input type)', () => {
  // specs/05-EXPORT-ENGINE.md section 1, contract item 4:
  // "No cell contains null, undefined, NaN, or [object Object]."
  // sanitizeCell's declared return type is string | number | boolean | Date | null - so a
  // value already in that union (number, boolean, Date) must pass through unchanged: it
  // needs no coercion (rule 6 is a separate, out-of-scope function) and is already a
  // legal Excel cell value. A value with NO legal cell representation (a plain object or
  // array - never sent by HubSpot per FINDINGS.md section 7, "every value arrives as
  // string | null") must not be stringified, since that risks emitting exactly the
  // forbidden "[object Object]" text. Treating it as an empty cell (null) is the only
  // choice consistent with contract item 4.
  const FORBIDDEN_STRINGS = ['[object Object]', 'undefined', 'NaN', 'null'];

  it.each([
    ['number 42', 42, 42],
    ['number 0 (falsy, must not become null)', 0, 0],
    ['boolean true', true, true],
    ['boolean false (falsy, must not become null)', false, false],
  ])('%s passes through unchanged', (_label, input, expected) => {
    expect(sanitizeCell(input)).toBe(expected);
  });

  it('a Date instance passes through unchanged', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    expect(sanitizeCell(date)).toBe(date);
  });

  it('a plain object has no legal cell representation and becomes an empty cell', () => {
    expect(sanitizeCell({})).toBeNull();
  });

  it('an array has no legal cell representation and becomes an empty cell', () => {
    expect(sanitizeCell([])).toBeNull();
  });

  it.each([
    ['number 42', 42],
    ['number 0', 0],
    ['boolean true', true],
    ['boolean false', false],
    ['plain object', {}],
    ['array', []],
    ['Date', new Date('2026-01-01T00:00:00.000Z')],
  ])('%s never renders as a forbidden string', (_label, input) => {
    const result = sanitizeCell(input);
    for (const forbidden of FORBIDDEN_STRINGS) {
      expect(result).not.toBe(forbidden);
    }
  });
});

// sanitizeRawForCoercion is the shared seam lib/export/writer.ts and
// lib/exportPreview.ts both call before mapCell - a single implementation,
// tested once here, rather than one copy per caller (see this function's
// own doc comment for the full rationale).
describe('sanitizeRawForCoercion - prepares a raw string for type coercion (rule 6)', () => {
  it('strips control characters and normalises line endings exactly like sanitizeCell', () => {
    expect(sanitizeRawForCoercion('a' + NUL + 'b')).toBe('ab');
    expect(sanitizeRawForCoercion('a' + CR + LF + 'b')).toBe('a' + LF + 'b');
  });

  it('undoes rule 4\'s leading-quote injection defence, so a numeric-looking value still starts with its original character', () => {
    // sanitizeCell alone would turn "-5" into "'-5" (rule 4) - fine for a TEXT
    // cell, but fatal for a value about to be parsed as a number.
    expect(sanitizeRawForCoercion('-5')).toBe('-5');
    expect(sanitizeRawForCoercion('+1234')).toBe('+1234');
    expect(sanitizeRawForCoercion('=SUM(1,1)')).toBe('=SUM(1,1)');
    expect(sanitizeRawForCoercion('@mention')).toBe('@mention');
  });

  it('leaves a value that ALREADY started with a quote untouched - only an ADDED quote is undone', () => {
    expect(sanitizeRawForCoercion("'already-quoted")).toBe("'already-quoted");
  });

  it('a value with no leading injection character is unaffected beyond the usual sanitisation', () => {
    expect(sanitizeRawForCoercion('1234.56')).toBe('1234.56');
    expect(sanitizeRawForCoercion('2026-03-15')).toBe('2026-03-15');
  });

  it('still truncates an over-length value (rule 5 is not undone, only rule 4 is)', () => {
    const raw = 'x'.repeat(32768);
    const result = sanitizeRawForCoercion(raw);
    expect(result.length).toBe(32764);
    expect(result.endsWith(ELLIPSIS_SUFFIX)).toBe(true);
  });
});
