/**
 * Shared client-side types for the export builder (specs/07-TASKS.md T17).
 * Plain string unions, not the Prisma enums: these files are 'use client'
 * and pulling the generated Prisma client into the browser bundle for an
 * enum's string values would be pure bloat (same reasoning as
 * components/dashboard/run-status-badge.tsx). The values match the real
 * enums by construction - lib/schemas.ts (server-side) is the one place
 * that validates against them for real.
 */

export type ObjectTypeValue = "CONTACTS" | "COMPANIES" | "DEALS" | "TICKETS"
export type HeaderStyleValue = "LABEL" | "INTERNAL" | "BOTH"
export type FilterOperator =
  | "EQ"
  | "NEQ"
  | "GT"
  | "LT"
  | "BETWEEN"
  | "HAS_PROPERTY"
  | "NOT_HAS_PROPERTY"
  | "IN"

export interface ObjectTypeOption {
  value: ObjectTypeValue
  label: string
  slug: string
}

export const OBJECT_TYPE_OPTIONS: ObjectTypeOption[] = [
  { value: "CONTACTS", label: "Contacts", slug: "contacts" },
  { value: "COMPANIES", label: "Companies", slug: "companies" },
  { value: "DEALS", label: "Deals", slug: "deals" },
  { value: "TICKETS", label: "Tickets", slug: "tickets" },
]

export const OBJECT_TYPE_SLUG: Record<ObjectTypeValue, string> = {
  CONTACTS: "contacts",
  COMPANIES: "companies",
  DEALS: "deals",
  TICKETS: "tickets",
}

export const OBJECT_TYPE_LABEL: Record<ObjectTypeValue, string> = {
  CONTACTS: "Contacts",
  COMPANIES: "Companies",
  DEALS: "Deals",
  TICKETS: "Tickets",
}

export const FILTER_OPERATOR_OPTIONS: { value: FilterOperator; label: string }[] = [
  { value: "EQ", label: "is" },
  { value: "NEQ", label: "is not" },
  { value: "GT", label: "is greater than" },
  { value: "LT", label: "is less than" },
  { value: "BETWEEN", label: "is between" },
  { value: "HAS_PROPERTY", label: "is known (has a value)" },
  { value: "NOT_HAS_PROPERTY", label: "is unknown (has no value)" },
  { value: "IN", label: "is one of" },
]

export interface FilterConditionState {
  property: string
  operator: FilterOperator
  /** Raw text input; EQ/NEQ/GT/LT/BETWEEN's low value. */
  value: string
  /** BETWEEN's high value. */
  highValue: string
  /** IN's comma-separated raw input, split into an array on save. */
  values: string
}

export function emptyFilterCondition(firstProperty: string): FilterConditionState {
  return { property: firstProperty, operator: "HAS_PROPERTY", value: "", highValue: "", values: "" }
}

export const MAX_FILTER_CONDITIONS = 5

export interface AssociationState {
  toObjectType: ObjectTypeValue
  columns: string[]
}

/** specs/05-EXPORT-ENGINE.md section 7: no cap is specced for association columns,
 *  but selecting hundreds would be as nonsensical as it is for the main picker. */
export const MAX_ASSOCIATION_COLUMNS = 25

export interface BuilderState {
  name: string
  objectType: ObjectTypeValue | null
  properties: string[]
  headerStyle: HeaderStyleValue
  filters: FilterConditionState[]
  association: AssociationState | null
  scheduleCron: string | null
  scheduleTz: string
  /** Raw comma/newline-separated input, split into an array on save. */
  recipients: string
}

export const INITIAL_BUILDER_STATE: BuilderState = {
  name: "",
  objectType: null,
  properties: [],
  headerStyle: "LABEL",
  filters: [],
  association: null,
  scheduleCron: null,
  scheduleTz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris",
  recipients: "",
}
