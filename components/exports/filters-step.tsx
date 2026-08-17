"use client"

import { useEffect, useState } from "react"
import {
  FILTER_OPERATOR_OPTIONS,
  MAX_FILTER_CONDITIONS,
  OBJECT_TYPE_SLUG,
  emptyFilterCondition,
  type FilterConditionState,
  type ObjectTypeValue,
} from "@/components/exports/types"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

interface PropertyOption {
  name: string
  label: string
}

const SELECT_CLASS =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

interface FiltersStepProps {
  objectType: ObjectTypeValue
  conditions: FilterConditionState[]
  onChange: (next: FilterConditionState[]) => void
}

/** Keyed by objectType (see property-picker.tsx's identical pattern) so
 *  going back and changing the object type cleanly refetches instead of
 *  imperatively resetting state inside the effect. */
export function FiltersStep(props: FiltersStepProps) {
  return <FiltersStepInner key={props.objectType} {...props} />;
}

function FiltersStepInner({ objectType, conditions, onChange }: FiltersStepProps) {
  const [properties, setProperties] = useState<PropertyOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/properties/${OBJECT_TYPE_SLUG[objectType]}`, { cache: "no-store" })
      .then((res) => res.json() as Promise<{ properties: PropertyOption[] }>)
      .then((data) => {
        if (cancelled) return;
        const sorted = [...data.properties].sort((a, b) => a.label.localeCompare(b.label));
        setProperties(sorted);
      })
      .catch(() => {
        if (!cancelled) setProperties([]);
      });

    return () => {
      cancelled = true;
    };
  }, [objectType]);

  function updateCondition(index: number, patch: Partial<FilterConditionState>) {
    onChange(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function removeCondition(index: number) {
    onChange(conditions.filter((_, i) => i !== index));
  }

  function addCondition() {
    if (conditions.length >= MAX_FILTER_CONDITIONS) return;
    onChange([...conditions, emptyFilterCondition(properties?.[0]?.name ?? "")]);
  }

  const atCap = conditions.length >= MAX_FILTER_CONDITIONS;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium">Filters (optional)</h3>
        <p className="text-xs text-muted-foreground">
          Up to {MAX_FILTER_CONDITIONS} conditions, all must match (AND only).
        </p>
      </div>

      {conditions.length === 0 && (
        <p className="text-sm text-muted-foreground">No filters - every record will be exported.</p>
      )}

      <div className="flex flex-col gap-2">
        {conditions.map((condition, index) => (
          <FilterConditionRow
            key={index}
            condition={condition}
            properties={properties ?? []}
            onChange={(patch) => updateCondition(index, patch)}
            onRemove={() => removeCondition(index)}
          />
        ))}
      </div>

      <div>
        <Button type="button" variant="outline" size="sm" onClick={addCondition} disabled={atCap || properties === null}>
          Add condition
        </Button>
        {atCap && (
          <p className="mt-1 text-xs text-muted-foreground">
            {MAX_FILTER_CONDITIONS} is the maximum for the MVP - split into a second export if you need more.
          </p>
        )}
      </div>
    </div>
  );
}

function FilterConditionRow({
  condition,
  properties,
  onChange,
  onRemove,
}: {
  condition: FilterConditionState
  properties: PropertyOption[]
  onChange: (patch: Partial<FilterConditionState>) => void
  onRemove: () => void
}) {
  const needsValue = ["EQ", "NEQ", "GT", "LT", "BETWEEN"].includes(condition.operator);
  const needsHighValue = condition.operator === "BETWEEN";
  const needsValues = condition.operator === "IN";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
      <select
        aria-label="Property"
        className={SELECT_CLASS}
        value={condition.property}
        onChange={(e) => onChange({ property: e.target.value })}
      >
        {properties.map((p) => (
          <option key={p.name} value={p.name}>
            {p.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Operator"
        className={SELECT_CLASS}
        value={condition.operator}
        onChange={(e) => onChange({ operator: e.target.value as FilterConditionState["operator"] })}
      >
        {FILTER_OPERATOR_OPTIONS.map((op) => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>

      {needsValue && (
        <Input
          className="w-36"
          aria-label={needsHighValue ? "From value" : "Value"}
          value={condition.value}
          onChange={(e) => onChange({ value: e.target.value })}
        />
      )}
      {needsHighValue && (
        <Input
          className="w-36"
          aria-label="To value"
          value={condition.highValue}
          onChange={(e) => onChange({ highValue: e.target.value })}
        />
      )}
      {needsValues && (
        <Input
          className="w-48"
          aria-label="Comma-separated values"
          placeholder="NEW, OPEN"
          value={condition.values}
          onChange={(e) => onChange({ values: e.target.value })}
        />
      )}

      <Button type="button" size="icon-xs" variant="ghost" onClick={onRemove} aria-label="Remove condition">
        ×
      </Button>
    </div>
  );
}
