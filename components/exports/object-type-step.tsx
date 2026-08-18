"use client"

import { OBJECT_TYPE_OPTIONS, type ObjectTypeValue } from "@/components/exports/types"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/**
 * The export's name lives here, on step 1, rather than on the schedule step
 * at the end: specs/07-TASKS.md T18's whole point is previewing "before
 * committing to a schedule," and the preview endpoint validates its body
 * with the same CreateExportSchema a save uses (lib/schemas.ts), which
 * requires a name. Asking for it up front means Preview is usable as soon
 * as an object type and a few properties are picked, not gated behind the
 * last step.
 */
export function ObjectTypeStep({
  name,
  onNameChange,
  value,
  onChange,
}: {
  name: string
  onNameChange: (next: string) => void
  value: ObjectTypeValue | null
  onChange: (next: ObjectTypeValue) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="export-name">Name this export</Label>
        <Input
          id="export-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="e.g. Q3 deals for finance"
          maxLength={120}
        />
        {/* recon/FINDINGS.md: two real portal rows ended up named "weekly" and
            "export" - a user answering the schedule preset or the object-type
            question below into this field instead of naming the export. This
            note plus a placeholder with no schedule/object-type vocabulary in
            it is the fix; a HubSpot object type is picked below, not here. */}
        <p className="text-xs text-muted-foreground">
          Just a label for your own reference - the object type and schedule are chosen separately below.
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Object type</legend>
        <div role="radiogroup" aria-label="Object type" className="grid gap-2 sm:grid-cols-2">
          {OBJECT_TYPE_OPTIONS.map((option) => {
            const checked = value === option.value;
            return (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-[13px] transition-colors hover:bg-muted",
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
    </div>
  );
}
