/**
 * Cell sanitisation - specs/05-EXPORT-ENGINE.md section 3.
 *
 * Six rules, applied in this exact order. Type coercion (rule 6) is a
 * separate function and out of scope here: a value already in the return
 * union (number, boolean, Date) passes through untouched.
 */

const EXCEL_MAX_CELL_LENGTH = 32767;
const TRUNCATE_TO = 32760;
const TRUNCATION_SUFFIX = ' [' + String.fromCharCode(0x2026) + ']';

/**
 * U+0000-U+0008, U+000B, U+000C, U+000E-U+001F. Tab (U+0009) and LF (U+000A)
 * fall in the gaps between these ranges, so "keep" needs no special case.
 */
function isStrippedControlChar(code: number): boolean {
  if (code <= 0x08) return true;
  if (code === 0x0b || code === 0x0c) return true;
  if (code >= 0x0e && code <= 0x1f) return true;
  return false;
}

function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    if (!isStrippedControlChar(ch.codePointAt(0) ?? 0)) out += ch;
  }
  return out;
}

function normaliseLineEndings(value: string): string {
  return value.split('\r\n').join('\n').split('\r').join('\n');
}

function quoteLeadingInjectionChar(value: string): string {
  const first = value.charAt(0);
  return first === '=' || first === '+' || first === '-' || first === '@' ? "'" + value : value;
}

function truncateToCellLimit(value: string): string {
  return value.length > EXCEL_MAX_CELL_LENGTH ? value.slice(0, TRUNCATE_TO) + TRUNCATION_SUFFIX : value;
}

export function sanitizeCell(raw: unknown): string | number | boolean | Date | null {
  // 1. null | undefined -> empty cell
  if (raw === null || raw === undefined) return null;

  // Not a string: type coercion is out of scope (rule 6). Values already
  // shaped like a legal cell pass through; anything else has no legal
  // representation and becomes an empty cell rather than risk stringifying
  // to something like "[object Object]".
  if (typeof raw !== 'string') {
    if (typeof raw === 'number' || typeof raw === 'boolean' || raw instanceof Date) {
      return raw;
    }
    return null;
  }

  let value = raw;
  value = stripControlChars(value); // 2
  value = normaliseLineEndings(value); // 3
  value = quoteLeadingInjectionChar(value); // 4
  value = truncateToCellLimit(value); // 5

  return value;
}

/**
 * Prepares a raw string for type coercion (rule 6, in lib/export/typeMap.ts's
 * mapCell) - spec section 3 rule 6 runs LAST, after sanitisation, so a raw
 * value bound for coercion is sanitised first (control characters stripped,
 * line endings normalised) exactly like any other value.
 *
 * Rule 4 (quote a leading = + - @) is a defence for TEXT cells against
 * formula injection - it is meaningless for a cell mapCell is about to turn
 * into a number, date, or boolean, and actively harmful: "-5" would become
 * "'-5", which then fails to parse as a number at all. So a quote ADDED by
 * this pass is undone before coercion; mapCell always sees the value with
 * its original leading character. If the coerced result is still a string,
 * a later `sanitizeCell(mapped.value)` call re-applies rule 4 to it -
 * injection defence on the actual text that ends up in the cell is
 * unaffected.
 *
 * The single seam every caller that runs the real pipeline must share:
 * lib/export/writer.ts (the real export) and lib/exportPreview.ts (the
 * preview) both call this, so "sanitise then coerce" cannot silently drift
 * between the two.
 */
export function sanitizeRawForCoercion(raw: string): string {
  const sanitized = sanitizeCell(raw);
  const text = typeof sanitized === 'string' ? sanitized : raw; // sanitizeCell(string) always returns a string
  if (text.startsWith("'") && !raw.startsWith("'")) return text.slice(1);
  return text;
}
