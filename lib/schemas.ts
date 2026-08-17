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
