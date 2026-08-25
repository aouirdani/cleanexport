"use client"

import { OBJECT_TYPE_OPTIONS, MAX_ASSOCIATION_COLUMNS, type AssociationState, type ObjectTypeValue } from "@/components/exports/types"
import { PropertyPicker } from "@/components/exports/property-picker"
import { Button } from "@/components/ui/button"

/**
 * specs/05-EXPORT-ENGINE.md section 7: single-level, `cardinality: "PRIMARY"`
 * only in the MVP ("JOIN - ship only if a customer asks") - so there is no
 * cardinality control here, it's hardcoded when this state is saved.
 */
export function AssociationsStep({
  objectType,
  value,
  onChange,
}: {
  objectType: ObjectTypeValue
  value: AssociationState | null
  onChange: (next: AssociationState | null) => void
}) {
  const targets = OBJECT_TYPE_OPTIONS.filter((o) => o.value !== objectType);

  if (!value) {
    return (
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Associations (optional)</h3>
        <p className="text-sm text-muted-foreground">
          Bring in columns from an associated record - for example a deal&apos;s company name.
        </p>
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange({ toObjectType: targets[0].value, columns: [] })}
          >
            Add an association
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Associations (optional)</h3>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          Remove association
        </Button>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-xs text-muted-foreground">Bring in columns from</legend>
        <div role="radiogroup" aria-label="Associated object type" className="flex gap-2">
          {targets.map((target) => (
            <label
              key={target.value}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm transition-colors hover:bg-muted has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="radio"
                name="associationTarget"
                value={target.value}
                checked={value.toObjectType === target.value}
                onChange={() => onChange({ toObjectType: target.value, columns: [] })}
                className="accent-primary"
              />
              {target.label}
            </label>
          ))}
        </div>
      </fieldset>

      <PropertyPicker
        objectType={value.toObjectType}
        selected={value.columns}
        onChange={(columns) => onChange({ ...value, columns })}
        cap={MAX_ASSOCIATION_COLUMNS}
        itemNoun={`${targets.find((t) => t.value === value.toObjectType)?.label ?? ""} columns`}
      />
    </div>
  );
}
