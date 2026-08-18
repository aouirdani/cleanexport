/**
 * Converts the builder's in-progress UI state (components/exports/types.ts's
 * `BuilderState`) into a `CreateExportSchema`-shaped body. Shared by
 * export-builder.tsx's save (`POST /api/exports`) and
 * preview-panel.tsx's preview (`POST /api/exports/preview`) - specs/07-TASKS.md
 * T18: "the unsaved-definition path validates with the same Zod schema as a
 * save," which only holds if both callers build the body the same way.
 *
 * Framework-free (no React import) so it's testable with plain Vitest, no
 * DOM needed - same reasoning as lib/propertyPicker.ts.
 */
import type { BuilderState, FilterConditionState } from "@/components/exports/types"

function toFilterConditionPayload(condition: FilterConditionState) {
  switch (condition.operator) {
    case "HAS_PROPERTY":
    case "NOT_HAS_PROPERTY":
      return { property: condition.property, operator: condition.operator };
    case "BETWEEN":
      return {
        property: condition.property,
        operator: condition.operator,
        value: condition.value,
        highValue: condition.highValue,
      };
    case "IN":
      return {
        property: condition.property,
        operator: condition.operator,
        values: condition.values
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      };
    default:
      return { property: condition.property, operator: condition.operator, value: condition.value };
  }
}

export function buildExportPayload(state: BuilderState) {
  return {
    name: state.name.trim(),
    objectType: state.objectType,
    properties: state.properties,
    headerStyle: state.headerStyle,
    filters:
      state.filters.length > 0 ? { operator: "AND" as const, conditions: state.filters.map(toFilterConditionPayload) } : undefined,
    associations:
      state.association && state.association.columns.length > 0
        ? { toObjectType: state.association.toObjectType, columns: state.association.columns }
        : undefined,
    scheduleCron: state.scheduleCron,
    scheduleTz: state.scheduleTz,
    recipients: state.recipients
      .split(/[,\n]/)
      .map((r) => r.trim())
      .filter(Boolean),
  };
}

/** Mirrors the minimum CreateExportSchema needs that aren't defaultable - see lib/schemas.ts. */
export function canPreview(state: BuilderState): boolean {
  return state.objectType !== null && state.properties.length > 0 && state.name.trim().length > 0;
}
