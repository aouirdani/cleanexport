"use client"

import { OBJECT_TYPE_OPTIONS, type ObjectTypeValue } from "@/components/exports/types"
import { cn } from "@/lib/utils"

export function ObjectTypeStep({
  value,
  onChange,
}: {
  value: ObjectTypeValue | null
  onChange: (next: ObjectTypeValue) => void
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">What do you want to export?</legend>
      <div role="radiogroup" aria-label="Object type" className="grid gap-2 sm:grid-cols-2">
        {OBJECT_TYPE_OPTIONS.map((option) => {
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:bg-muted",
                "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                checked && "border-primary bg-primary/5",
              )}
            >
              <input
                type="radio"
                name="objectType"
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="accent-primary"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
