"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SCHEDULE_PRESETS } from "@/lib/schedulePresets"

export function ScheduleStep({
  scheduleCron,
  onScheduleCronChange,
  scheduleTz,
  onScheduleTzChange,
  recipients,
  onRecipientsChange,
}: {
  scheduleCron: string | null
  onScheduleCronChange: (next: string | null) => void
  scheduleTz: string
  onScheduleTzChange: (next: string) => void
  recipients: string
  onRecipientsChange: (next: string) => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-section-title font-semibold">Schedule</legend>
        <div role="radiogroup" aria-label="Schedule" className="flex flex-wrap gap-2">
          {SCHEDULE_PRESETS.map((preset) => (
            <label
              key={preset.label}
              className="flex cursor-pointer items-center gap-1.5 rounded-[6px] border border-border px-2.5 py-1.5 text-table transition-colors hover:bg-muted has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="radio"
                name="schedulePreset"
                checked={scheduleCron === preset.cron}
                onChange={() => onScheduleCronChange(preset.cron)}
                className="accent-primary"
              />
              {preset.label}
            </label>
          ))}
        </div>
        {scheduleCron !== null && (
          <div className="mt-1 flex flex-col gap-1.5">
            <Label htmlFor="schedule-tz" className="text-metadata text-muted-foreground">
              Timezone
            </Label>
            <Input id="schedule-tz" value={scheduleTz} onChange={(e) => onScheduleTzChange(e.target.value)} className="w-56" />
          </div>
        )}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="recipients">Recipients</Label>
        <Input
          id="recipients"
          value={recipients}
          onChange={(e) => onRecipientsChange(e.target.value)}
          placeholder="ada@example.com, grace@example.com"
        />
        <p className="text-metadata text-muted-foreground">
          Comma-separated email addresses. Up to 10. Leave blank and use &quot;Run now&quot; later if no one
          needs it emailed.
        </p>
      </div>
    </div>
  );
}
