"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  filterProperties,
  sortForBrowsing,
  addProperty,
  removeProperty,
  moveProperty,
  reorder,
  computeVirtualRange,
  MAX_EXPORT_PROPERTIES,
  type PickerProperty,
} from "@/lib/propertyPicker"
import { OBJECT_TYPE_SLUG, type ObjectTypeValue } from "@/components/exports/types"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface RawProperty {
  name: string
  label: string
  type: string
  fieldType: string
  isSystem: boolean
  description: string | null
  calculated: boolean
  hidden: boolean
}

function toPickerProperty(raw: RawProperty): PickerProperty {
  return {
    name: raw.name,
    label: raw.label,
    type: raw.type,
    fieldType: raw.fieldType,
    isSystem: raw.isSystem,
    description: raw.description,
    calculated: raw.calculated,
    hidden: raw.hidden,
  }
}

const ROW_HEIGHT = 40
const VIEWPORT_HEIGHT = 320 // keep in sync with the scroll container's h-80 below

export interface PropertyPickerProps {
  objectType: ObjectTypeValue
  selected: string[]
  onChange: (next: string[]) => void
  cap?: number
  /** e.g. "properties to export" vs. "columns to bring back" - varies by caller. */
  itemNoun?: string
}

/**
 * recon/FINDINGS.md section 2: a real portal has 399 contact properties, 315
 * of them `hs_` system ones, and a custom-property portal exceeds 500 - "the
 * picker in T17 must be searchable and virtualised, not a plain <select>."
 *
 * Two independent lists, on purpose:
 *   - "Available" is a filtered VIEW (search + system toggle) over the full
 *     fetched property list. It never drives `selected`.
 *   - "Selected" is `selected` itself, in order, rendered from the full
 *     property list keyed by name - never from `available`. This is what
 *     makes a search that hides an already-picked property harmless: the
 *     Selected pane doesn't look at the search at all.
 */
/**
 * Thin wrapper keyed by `objectType`: switching object types (main picker
 * step -> a different association target, say) should reset search, the
 * system toggle, and scroll position to a clean slate. Remounting via `key`
 * gets that for free from React's own state-reset-on-remount behaviour,
 * instead of imperatively resetting four pieces of state inside an effect.
 */
export function PropertyPicker(props: PropertyPickerProps) {
  return <PropertyPickerInner key={props.objectType} {...props} />;
}

function PropertyPickerInner({
  objectType,
  selected,
  onChange,
  cap = MAX_EXPORT_PROPERTIES,
  itemNoun = "properties",
}: PropertyPickerProps) {
  const [properties, setProperties] = useState<PickerProperty[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showSystem, setShowSystem] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragIndexRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/properties/${OBJECT_TYPE_SLUG[objectType]}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load properties for this object type.");
        return (await res.json()) as { properties: RawProperty[] };
      })
      .then((data) => {
        if (cancelled) return;
        setProperties(data.properties.map(toPickerProperty));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : "Could not load properties.");
      });

    return () => {
      cancelled = true;
    };
  }, [objectType]);

  const byName = useMemo(() => {
    const map = new Map<string, PickerProperty>();
    for (const p of properties ?? []) map.set(p.name, p);
    return map;
  }, [properties]);

  const available = useMemo(
    () => sortForBrowsing(filterProperties(properties ?? [], { search, showSystem })),
    [properties, search, showSystem],
  );

  // The Selected pane is built from `selected` (the ordered source of
  // truth) joined against `byName` for display details - never sliced from
  // `available`. specs/AGENTS.md rule 9: this order is a product promise.
  const selectedDetails = selected
    .map((name) => ({ name, detail: byName.get(name) }))
    .filter((entry): entry is { name: string; detail: PickerProperty } => Boolean(entry.detail));

  const atCap = selected.length >= cap;

  function handleToggle(name: string) {
    if (selected.includes(name)) {
      onChange(removeProperty(selected, name));
      return;
    }
    const result = addProperty(selected, name, cap);
    if (result.added) onChange(result.selected);
  }

  function handleMove(name: string, direction: "up" | "down") {
    onChange(moveProperty(selected, name, direction));
  }

  function handleRemove(name: string) {
    onChange(removeProperty(selected, name));
  }

  function handleDrop(targetIndex: number) {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    if (from === null) return;
    onChange(reorder(selected, from, targetIndex));
  }

  const range = computeVirtualRange({
    itemCount: available.length,
    rowHeight: ROW_HEIGHT,
    scrollTop,
    viewportHeight: VIEWPORT_HEIGHT,
  });
  const visibleRows = available.slice(range.start, range.end);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Available pane */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <Input
              placeholder="Search by name or label…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label={`Search ${itemNoun}`}
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="show-system" checked={showSystem} onCheckedChange={setShowSystem} />
            <Label htmlFor="show-system" className="font-normal text-muted-foreground">
              Show system properties (hs_*)
            </Label>
          </div>

          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
          {properties === null && !loadError && (
            <p className="text-sm text-muted-foreground">Loading properties…</p>
          )}

          {properties !== null && (
            <div
              ref={scrollRef}
              role="listbox"
              aria-multiselectable="true"
              aria-label={`Available ${itemNoun}`}
              tabIndex={0}
              className="h-80 overflow-y-auto rounded-lg border border-border"
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            >
              {available.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No properties match your search.</p>
              ) : (
                <div style={{ height: range.totalHeight, position: "relative" }}>
                  <div style={{ transform: `translateY(${range.offsetY}px)` }}>
                    {visibleRows.map((property) => (
                      <PropertyRow
                        key={property.name}
                        property={property}
                        checked={selected.includes(property.name)}
                        disabled={atCap && !selected.includes(property.name)}
                        onToggle={() => handleToggle(property.name)}
                        style={{ height: ROW_HEIGHT }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Selected pane */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              Selected ({selected.length}/{cap})
            </span>
          </div>
          {atCap && (
            <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              You&apos;ve reached the {cap}-property limit. More columns than that produce a slow, unusable
              file - remove one to add another.
            </p>
          )}
          <ol className="h-80 overflow-y-auto rounded-lg border border-border" aria-label={`Selected ${itemNoun}, in column order`}>
            {selectedDetails.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">
                Nothing selected yet. Pick properties on the left - they&apos;ll appear here in column order.
              </p>
            ) : (
              selectedDetails.map(({ name, detail }, index) => (
                <SelectedRow
                  key={name}
                  index={index}
                  property={detail}
                  isFirst={index === 0}
                  isLast={index === selectedDetails.length - 1}
                  onMoveUp={() => handleMove(name, "up")}
                  onMoveDown={() => handleMove(name, "down")}
                  onRemove={() => handleRemove(name)}
                  onDragStart={() => {
                    dragIndexRef.current = index;
                  }}
                  onDropOn={() => handleDrop(index)}
                />
              ))
            )}
          </ol>
        </div>
      </div>
    </div>
  );
}

function PropertyMeta({ property }: { property: PickerProperty }) {
  if (!property.isSystem && !property.calculated && !property.hidden) return null;
  return (
    <span className="flex shrink-0 gap-1">
      {property.isSystem && <Badge variant="outline">System</Badge>}
      {property.calculated && <Badge variant="secondary">Calculated</Badge>}
      {property.hidden && <Badge variant="warning">Hidden</Badge>}
    </span>
  );
}

function PropertyRow({
  property,
  checked,
  disabled,
  onToggle,
  style,
}: {
  property: PickerProperty
  checked: boolean
  disabled: boolean
  onToggle: () => void
  style?: React.CSSProperties
}) {
  return (
    <div style={style} className="group/row relative flex items-center border-b border-border/60 last:border-0">
      <button
        type="button"
        role="option"
        aria-selected={checked}
        disabled={disabled}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          readOnly
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none size-3.5 accent-primary"
        />
        <span className="min-w-0 flex-1 truncate">
          <span className="truncate font-medium">{property.label}</span>{" "}
          <span className="truncate font-mono text-xs text-muted-foreground">{property.name}</span>
        </span>
        <PropertyMeta property={property} />
      </button>
      {/* recon/FINDINGS.md section 13: description as tooltip text. Shown on
          hover OR keyboard focus (group-focus-within), not hover-only, so a
          keyboard user tabbing through visible rows still gets it. */}
      {property.description && (
        <span
          role="tooltip"
          className="pointer-events-none absolute top-full left-2 z-10 mt-1 hidden max-w-xs rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover/row:block group-focus-within/row:block"
        >
          {property.description}
        </span>
      )}
    </div>
  );
}

function SelectedRow({
  index,
  property,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onRemove,
  onDragStart,
  onDropOn,
}: {
  index: number
  property: PickerProperty
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
  onDragStart: () => void
  onDropOn: () => void
}) {
  return (
    <li
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropOn();
      }}
      className="flex items-center gap-2 border-b border-border/60 px-2.5 py-2 text-sm last:border-0"
    >
      <span className="w-5 shrink-0 cursor-grab text-muted-foreground select-none" aria-hidden title="Drag to reorder">
        ⠿
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="truncate font-medium">{property.label}</span>{" "}
        <span className="truncate font-mono text-xs text-muted-foreground">{property.name}</span>
      </span>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={isFirst}
          onClick={onMoveUp}
          aria-label={`Move ${property.label} up (column ${index})`}
        >
          ↑
        </Button>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          disabled={isLast}
          onClick={onMoveDown}
          aria-label={`Move ${property.label} down (column ${index + 2})`}
        >
          ↓
        </Button>
        <Button type="button" size="icon-xs" variant="ghost" onClick={onRemove} aria-label={`Remove ${property.label}`}>
          ×
        </Button>
      </div>
    </li>
  );
}
