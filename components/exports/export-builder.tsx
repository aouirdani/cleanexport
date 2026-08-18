"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { INITIAL_BUILDER_STATE, OBJECT_TYPE_LABEL, type BuilderState, type ObjectTypeValue } from "@/components/exports/types"
import { buildExportPayload } from "@/components/exports/payload"
import { ObjectTypeStep } from "@/components/exports/object-type-step"
import { PropertyPicker } from "@/components/exports/property-picker"
import { HeaderStyleStep } from "@/components/exports/header-style-step"
import { FiltersStep } from "@/components/exports/filters-step"
import { AssociationsStep } from "@/components/exports/associations-step"
import { ScheduleStep } from "@/components/exports/schedule-step"
import { PreviewPanel } from "@/components/exports/preview-panel"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const STEPS = [
  "Object type",
  "Properties",
  "Header row",
  "Filters",
  "Associations",
  "Schedule",
] as const;

function canAdvance(step: number, state: BuilderState): boolean {
  if (step === 0) return state.name.trim().length > 0 && state.objectType !== null;
  if (step === 1) return state.properties.length > 0;
  return true;
}

export function ExportBuilder() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [state, setState] = useState<BuilderState>(INITIAL_BUILDER_STATE);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function patch(next: Partial<BuilderState>) {
    setState((prev) => ({ ...prev, ...next }));
  }

  function handleObjectTypeChange(next: ObjectTypeValue) {
    if (next === state.objectType) return;
    // Property names, filters, and association columns are all specific to
    // the previous object type - carrying them across a change would save
    // garbage internal names silently. Clear the downstream state instead.
    setState((prev) => ({ ...prev, objectType: next, properties: [], filters: [], association: null }));
  }

  async function handleSave() {
    if (!state.objectType || state.properties.length === 0 || state.name.trim().length === 0) {
      setSaveError("Give the export a name, an object type, and at least one property before saving.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/exports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildExportPayload(state)),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setSaveError(body?.error?.message ?? "Could not save this export. Please try again.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setSaveError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const objectType = state.objectType;

  return (
    <div className="flex flex-col gap-6">
      <Stepper current={step} onSelect={(i) => (i < step || canAdvance(step, state) ? setStep(i) : undefined)} />

      <Card>
        <CardContent className="py-5 sm:p-6">
          {step === 0 && (
            <ObjectTypeStep
              name={state.name}
              onNameChange={(name) => patch({ name })}
              value={state.objectType}
              onChange={handleObjectTypeChange}
            />
          )}

          {step === 1 && objectType && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Properties for {OBJECT_TYPE_LABEL[objectType]}</h3>
              <PropertyPicker
                objectType={objectType}
                selected={state.properties}
                onChange={(properties) => patch({ properties })}
              />
            </div>
          )}

          {step === 2 && <HeaderStyleStep value={state.headerStyle} onChange={(headerStyle) => patch({ headerStyle })} />}

          {step === 3 && objectType && (
            <FiltersStep objectType={objectType} conditions={state.filters} onChange={(filters) => patch({ filters })} />
          )}

          {step === 4 && objectType && (
            <AssociationsStep objectType={objectType} value={state.association} onChange={(association) => patch({ association })} />
          )}

          {step === 5 && (
            <ScheduleStep
              scheduleCron={state.scheduleCron}
              onScheduleCronChange={(scheduleCron) => patch({ scheduleCron })}
              scheduleTz={state.scheduleTz}
              onScheduleTzChange={(scheduleTz) => patch({ scheduleTz })}
              recipients={state.recipients}
              onRecipientsChange={(recipients) => patch({ recipients })}
            />
          )}
        </CardContent>
      </Card>

      <PreviewPanel state={state} />

      {saveError && <p className="text-sm text-destructive">{saveError}</p>}

      <div className="flex items-center justify-between border-t border-border pt-5">
        <Button type="button" variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button type="button" size="lg" onClick={() => setStep((s) => s + 1)} disabled={!canAdvance(step, state)}>
            Next
          </Button>
        ) : (
          <Button type="button" size="lg" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save export"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Stepper({ current, onSelect }: { current: number; onSelect: (index: number) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[13px]">
      {STEPS.map((label, index) => (
        <li key={label} className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSelect(index)}
            aria-current={index === current ? "step" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-full border border-border py-1 pr-3 pl-1.5 transition-colors",
              index === current
                ? "border-primary bg-primary text-primary-foreground"
                : index < current
                  ? "text-foreground hover:bg-muted"
                  : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full text-[11px] tabular-nums",
                index === current
                  ? "bg-primary-foreground/20"
                  : index < current
                    ? "bg-muted"
                    : "bg-muted/60",
              )}
            >
              {index + 1}
            </span>
            {label}
          </button>
          {index < STEPS.length - 1 && <span aria-hidden className="h-px w-3 bg-border" />}
        </li>
      ))}
    </ol>
  );
}
