/**
 * Deliberately fixed locale + UTC timezone, not the runtime's default: these
 * helpers run inside a 'use client' component that Next.js also renders on
 * the server for the first paint. Letting `toLocaleString()` fall back to
 * whatever locale/timezone each environment happens to have would produce a
 * different string server-side vs. client-side and trip a hydration
 * mismatch. UTC also reads unambiguously in a screenshot from a support
 * ticket, regardless of which timezone the customer or the maintainer is in.
 */
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

export function formatDateTime(value: Date | string | null): string {
  if (!value) return "—"
  return `${DATE_TIME_FORMAT.format(new Date(value))} UTC`
}

export function formatRowCount(value: number | null): string {
  if (value === null) return "—"
  return value.toLocaleString("en-US")
}

export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "—"
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
