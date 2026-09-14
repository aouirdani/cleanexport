/**
 * Zod schemas for request bodies - specs/06-API-CONTRACT.md: "Every handler
 * validates its body with a Zod schema defined in lib/schemas.ts."
 *
 * FiltersSchema/AssociationsSchema mirror the JSON shapes in
 * specs/05-EXPORT-ENGINE.md sections 6 and 7 exactly - lib/export/fetch.ts's
 * `Filters` interface and lib/export/associations.ts's association spec are
 * the runtime consumers of this same shape (that file is not touched here,
 * only matched).
 */
import { z } from 'zod';

export const OBJECT_TYPES = ['CONTACTS', 'COMPANIES', 'DEALS', 'TICKETS'] as const;
export const HEADER_STYLES = ['LABEL', 'INTERNAL', 'BOTH'] as const;

/** specs/01-PRD.md A3: the seven operators the MVP filter UI offers. */
export const FILTER_OPERATORS = [
  'EQ',
  'NEQ',
  'GT',
  'LT',
  'BETWEEN',
  'HAS_PROPERTY',
  'NOT_HAS_PROPERTY',
  'IN',
] as const;

const FilterConditionSchema = z.discriminatedUnion('operator', [
  z.object({ property: z.string().min(1), operator: z.literal('EQ'), value: z.string().min(1) }),
  z.object({ property: z.string().min(1), operator: z.literal('NEQ'), value: z.string().min(1) }),
  z.object({ property: z.string().min(1), operator: z.literal('GT'), value: z.string().min(1) }),
  z.object({ property: z.string().min(1), operator: z.literal('LT'), value: z.string().min(1) }),
  z.object({
    property: z.string().min(1),
    operator: z.literal('BETWEEN'),
    value: z.string().min(1),
    highValue: z.string().min(1),
  }),
  z.object({ property: z.string().min(1), operator: z.literal('HAS_PROPERTY') }),
  z.object({ property: z.string().min(1), operator: z.literal('NOT_HAS_PROPERTY') }),
  z.object({ property: z.string().min(1), operator: z.literal('IN'), values: z.array(z.string().min(1)).min(1) }),
]);

/** specs/05-EXPORT-ENGINE.md section 6: max 5 conditions, AND only, in the MVP. */
export const FiltersSchema = z.object({
  operator: z.literal('AND'),
  conditions: z.array(FilterConditionSchema).min(1).max(5),
});

/** specs/05-EXPORT-ENGINE.md section 7: cardinality PRIMARY only ships in the MVP. */
export const AssociationsSchema = z.object({
  toObjectType: z.enum(OBJECT_TYPES),
  columns: z.array(z.string().min(1)).min(1),
  cardinality: z.enum(['PRIMARY', 'JOIN']).default('PRIMARY'),
});

/** 5-field cron ("minute hour day-of-month month day-of-week") - matches the
 *  shape inngest/scheduleTick.ts's matcher expects. Only the field COUNT is
 *  validated here; the matcher itself is the source of truth for per-field syntax. */
const CRON_SHAPE = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/;

/**
 * The floor on how often a schedule may fire. The builder UI only offers
 * daily/weekly/monthly presets (lib/schedulePresets.ts), but this field
 * accepts any 5-field cron shape, so nothing previously stopped a
 * hand-crafted request from saving `*\/5 * * * *` - a schedule that fires
 * every 5 minutes, 288 times a day, against a RUN_EXPORT limit of 20/day
 * and whatever the customer's own email provider tolerates before flagging
 * the sending domain as spam.
 *
 * One hour, not something coarser or finer:
 *   - Strictly stricter than every existing preset (all daily-or-coarser),
 *     so no schedule anyone has already saved is invalidated by this change.
 *   - It's an honest escape valve: a customer who genuinely needs
 *     tighter-than-daily refresh (e.g. hourly during business hours) has a
 *     real way to express that, rather than the floor being so coarse it
 *     pushes them toward a dishonest workaround.
 *   - It keeps the worst case bounded to a sane number - at most 24
 *     runs/day per export, close to (and self-limiting against) the
 *     existing RUN_EXPORT cap of 20/day, not 288 or 1440.
 *
 * Enforced by requiring the MINUTE field to be a single literal value (no
 * wildcard, list, range, or step): with an unconstrained hour field
 * (`*`), the minute field is the only place a cron can encode firing more
 * than once per hour, so constraining just that one field is sufficient.
 * A minute-field step that happens to still resolve to at most once per
 * hour (e.g. "0/60") is rejected too, for simplicity - no legitimate
 * schedule needs one, and allowing it would reopen exactly the parsing
 * complexity this simple rule is meant to avoid.
 */
export const MIN_SCHEDULE_INTERVAL_MINUTES = 60;

const SINGLE_LITERAL_MINUTE = /^\d+$/;

function respectsMinScheduleInterval(cron: string): boolean {
  const [minuteField] = cron.trim().split(/\s+/);
  return SINGLE_LITERAL_MINUTE.test(minuteField);
}

export const CreateExportSchema = z
  .object({
    name: z.string().min(1).max(120),
    objectType: z.enum(OBJECT_TYPES),
    // Order is meaningful - specs/AGENTS.md rule 9. Zod validates length/content;
    // nothing here (or downstream) may sort, dedupe via Set, or rebuild this array.
    properties: z
      .array(z.string().min(1))
      .min(1)
      .max(200) // specs/06-API-CONTRACT.md: 400 columns is an unusable file and a slow export
      .refine((arr) => new Set(arr).size === arr.length, { message: 'Duplicate properties are not allowed' }),
    headerStyle: z.enum(HEADER_STYLES).default('LABEL'),
    filters: FiltersSchema.nullable().optional(),
    associations: AssociationsSchema.nullable().optional(),
    scheduleCron: z
      .string()
      .regex(CRON_SHAPE, 'Expected a 5-field cron expression (minute hour day-of-month month day-of-week)')
      .refine(respectsMinScheduleInterval, {
        message:
          'Schedules can run at most once per hour - use a single fixed minute (e.g. "0 * * * *"), not a wildcard, list, range, or step in the minute field.',
      })
      .nullable()
      .optional(),
    scheduleTz: z.string().default('Europe/Paris'),
    recipients: z.array(z.string().email()).max(10).default([]),
  })
  .refine((data) => !data.associations || data.associations.toObjectType !== data.objectType, {
    message: 'An export cannot associate an object type to itself',
    path: ['associations', 'toObjectType'],
  });

export type CreateExportInput = z.infer<typeof CreateExportSchema>;

/**
 * PATCH /api/exports/:id's body. specs/06-API-CONTRACT.md describes PATCH
 * generically as "partial update," but the only caller today is the
 * dashboard's pause/resume toggle (specs/AGENTS.md rule 1: implement the
 * task given, nothing else) - so this only accepts `isActive` for now.
 * Widen it, and the route that reads it, together if a future task needs
 * to PATCH other fields.
 */
export const PatchExportSchema = z.object({
  isActive: z.boolean(),
});

export type PatchExportInput = z.infer<typeof PatchExportSchema>;

/** specs/01-PRD.md A7: "$29/month or $290/year." POST /api/billing/checkout's body. */
export const CheckoutSchema = z.object({
  plan: z.enum(['monthly', 'yearly']),
});
