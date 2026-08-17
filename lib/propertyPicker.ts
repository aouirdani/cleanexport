/**
 * Pure logic behind components/exports/property-picker.tsx - specs/07-TASKS.md
 * T17. Deliberately framework-free: search/filter/reorder/cap are plain
 * array operations on `selected: string[]`, testable without React or a DOM,
 * and the component is a thin renderer over these.
 *
 * specs/AGENTS.md rule 9 and specs/03-DATA-MODEL.md: `ExportDefinition.properties`
 * order IS the column order and is a product promise - every function here
 * that touches `selected` returns a new array via slice/splice/filter, never
 * a Set, never Array.from(new Set(...)), never Object.keys().
 */

export interface PickerProperty {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  isSystem: boolean;
  description: string | null;
  calculated: boolean;
  hidden: boolean;
}

/** specs/06-API-CONTRACT.md CreateExportSchema: `properties` is capped at 200. */
export const MAX_EXPORT_PROPERTIES = 200;

export function matchesSearch(property: Pick<PickerProperty, 'name' | 'label'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // recon/FINDINGS.md section 2: search must match BOTH the internal name
  // and the human label - a user might type either "firstname" or "First Name".
  return property.name.toLowerCase().includes(q) || property.label.toLowerCase().includes(q);
}

export interface FilterPropertiesOptions {
  search?: string;
  /** System (`hs_*`) properties are OFF by default - recon/FINDINGS.md section 2: 315 of 399 are noise. */
  showSystem?: boolean;
}

export function filterProperties(
  properties: PickerProperty[],
  opts: FilterPropertiesOptions = {},
): PickerProperty[] {
  const { search = '', showSystem = false } = opts;
  return properties.filter((p) => (showSystem || !p.isSystem) && matchesSearch(p, search));
}

/** Alphabetical by label, for the Available pane only - never applied to `selected`. */
export function sortForBrowsing(properties: PickerProperty[]): PickerProperty[] {
  return [...properties].sort((a, b) => a.label.localeCompare(b.label));
}

export interface AddPropertyResult {
  selected: string[];
  added: boolean;
  /** True when the add was refused because `selected` was already at `cap`. */
  atCap: boolean;
}

export function addProperty(
  selected: string[],
  name: string,
  cap: number = MAX_EXPORT_PROPERTIES,
): AddPropertyResult {
  if (selected.includes(name)) return { selected, added: false, atCap: false };
  if (selected.length >= cap) return { selected, added: false, atCap: true };
  return { selected: [...selected, name], added: true, atCap: false };
}

export function removeProperty(selected: string[], name: string): string[] {
  return selected.filter((n) => n !== name);
}

/**
 * Moves the item at `from` to index `to`, preserving every other item's
 * relative order. The one function both HTML5 drag-and-drop and the
 * keyboard Up/Down buttons call, so the two input methods produce identical
 * results by construction rather than by two separately-maintained code paths.
 */
export function reorder<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function moveProperty(selected: string[], name: string, direction: 'up' | 'down'): string[] {
  const index = selected.indexOf(name);
  if (index === -1) return selected;
  const target = direction === 'up' ? index - 1 : index + 1;
  return reorder(selected, index, target);
}

export interface VirtualRange {
  start: number;
  end: number;
  offsetY: number;
  totalHeight: number;
}

/**
 * Windowing math for the Available list (recon/FINDINGS.md section 2: "The
 * picker in T17 must be searchable and virtualised, not a plain <select>" -
 * a real portal has 399 contact properties and custom-property portals
 * exceed 500). Renders only rows in [start, end) at a fixed row height;
 * `offsetY`/`totalHeight` let the caller keep true scrollbar proportions
 * with a single spacer instead of one DOM node per row.
 */
export function computeVirtualRange(opts: {
  itemCount: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
}): VirtualRange {
  const { itemCount, rowHeight, scrollTop, viewportHeight, overscan = 6 } = opts;
  const totalHeight = itemCount * rowHeight;
  if (itemCount === 0 || rowHeight <= 0) return { start: 0, end: 0, offsetY: 0, totalHeight };

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(itemCount, start + visibleCount);

  return { start, end, offsetY: start * rowHeight, totalHeight };
}
