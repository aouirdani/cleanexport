"use client"

import type { HeaderStyleValue } from "@/components/exports/types"
import { cn } from "@/lib/utils"

const OPTIONS: { value: HeaderStyleValue; label: string; description: string }[] = [
  { value: "LABEL", label: "Labels", description: 'Row 1 has human-readable headers ("First Name"). Data from row 2.' },
  { value: "INTERNAL", label: "Internal names", description: 'Row 1 has HubSpot internal names ("firstname"), for feeding another system. Data from row 2.' },
  { value: "BOTH", label: "Both", description: "Row 1 labels, row 2 internal names, data from row 3." },
]

export function HeaderStyleStep({
  value,
  onChange,
}: {
  value: HeaderStyleValue
  onChange: (next: HeaderStyleValue) => void
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">Header row</legend>
      <div role="radiogroup" aria-label="Header style" className="flex flex-col gap-2">
        {OPTIONS.map((option) => {
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm transition-colors hover:bg-muted",
                "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                checked && "border-primary bg-primary/5",
              )}
            >
              <input
                type="radio"
                name="headerStyle"
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="mt-0.5 accent-primary"
              />
              <span>
                <span className="block font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
