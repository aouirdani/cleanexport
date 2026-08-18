/**
 * One structured logger, JSON output - specs/07-TASKS.md T22.
 *
 * Every call site is expected to pass `portalId` (and `exportRunId` where
 * one exists) in its context object - that's what makes a log line usable
 * later ("show me everything for portal X's run Y"), not a type-level
 * requirement (a health check or a pre-session OAuth failure genuinely has
 * no portalId yet).
 *
 * Every line is scrubbed through lib/scrub.ts before it's serialised -
 * this is the ONE place `console.*` is called from in application code
 * (specs/07-TASKS.md: "replace the console.error calls scattered through
 * the codebase"). A caller can pass whatever it wants in `context`,
 * including a raw error object or a whole record, and the sensitive-key and
 * sensitive-value rules still apply.
 */
import { scrubValue } from '@/lib/scrub';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LEVELS)[number];

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function configuredLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return (LEVELS as readonly string[]).includes(raw) ? (raw as LogLevel) : 'info';
}

export interface LogContext {
  portalId?: string;
  exportRunId?: string;
  [key: string]: unknown;
}

const CONSOLE_FOR_LEVEL: Record<LogLevel, (line: string) => void> = {
  debug: (line) => console.debug(line),
  info: (line) => console.log(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

function emit(level: LogLevel, message: string, context: LogContext): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[configuredLevel()]) return;

  const record = scrubValue({
    level,
    message,
    time: new Date().toISOString(),
    ...context,
  });

  CONSOLE_FOR_LEVEL[level](JSON.stringify(record));
}

export const logger = {
  debug: (message: string, context: LogContext = {}) => emit('debug', message, context),
  info: (message: string, context: LogContext = {}) => emit('info', message, context),
  warn: (message: string, context: LogContext = {}) => emit('warn', message, context),
  error: (message: string, context: LogContext = {}) => emit('error', message, context),
};
