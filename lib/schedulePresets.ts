/**
 * The fixed set of schedule frequencies the builder offers
 * (components/exports/schedule-step.tsx) - a small, deliberately closed list
 * rather than a free-text cron field, so a customer never has to know cron
 * syntax. Pulled out to its own module so the builder UI and
 * scripts/backfill-invalid-schedules.mts (recovering legacy rows written
 * with a plain frequency word instead of one of these cron expressions)
 * read the exact same mapping instead of two copies drifting apart.
 */

export interface SchedulePreset {
  label: string;
  cron: string | null;
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { label: 'Manual only', cron: null },
  { label: 'Daily at 6am', cron: '0 6 * * *' },
  { label: 'Weekly, Monday 6am', cron: '0 6 * * 1' },
  { label: 'Monthly, 1st at 6am', cron: '0 6 1 * *' },
];

/**
 * Recovery map for legacy rows: `ExportDefinition.scheduleCron` holding a
 * bare frequency word ("weekly") instead of a cron expression, from before
 * this field was validated server-side (see lib/schemas.ts's CRON_SHAPE).
 * Keyed by the lowercased word a confused build of the UI, or a user typing
 * a preset's own label into the wrong field, could plausibly have produced.
 * Deliberately NOT exhaustive - an unrecognized value (e.g. "export", which
 * matches nothing here) must stay unrecognized rather than get a guessed
 * cron, per specs/AGENTS.md rule 10 ("fail loudly, not silently").
 */
export const LEGACY_FREQUENCY_WORDS: Record<string, string> = {
  daily: '0 6 * * *',
  weekly: '0 6 * * 1',
  monthly: '0 6 1 * *',
};
