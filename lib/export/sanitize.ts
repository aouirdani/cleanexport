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
