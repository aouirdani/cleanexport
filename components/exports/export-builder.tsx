"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  INITIAL_BUILDER_STATE,
  OBJECT_TYPE_LABEL,
  type BuilderState,
  type FilterConditionState,
  type ObjectTypeValue,
} from "@/components/exports/types"
import { ObjectTypeStep } from "@/components/exports/object-type-step"
import { PropertyPicker } from "@/components/exports/property-picker"
import { HeaderStyleStep } from "@/components/exports/header-style-step"
import { FiltersStep } from "@/components/exports/filters-step"
import { AssociationsStep } from "@/components/exports/associations-step"
import { ScheduleStep } from "@/components/exports/schedule-step"
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

function toFilterConditionPayload(condition: FilterConditionState) {
  switch (condition.operator) {
    case "HAS_PROPERTY":
    case "NOT_HAS_PROPERTY":
      return { property: condition.property, operator: condition.operator };
    case "BETWEEN":
      return { property: condition.property, operator: condition.operator, value: condition.value, highValue: condition.highValue };
    case "IN":
      return {
        property: condition.property,
        operator: condition.operator,
        values: condition.values.split(",").map((v) => v.trim()).filter(Boolean),
      };
    default:
      return { property: condition.property, operator: condition.operator, value: condition.value };
  }
}

function buildPayload(state: BuilderState) {
  return {
    name: state.name.trim(),
    objectType: state.objectType,
    properties: state.properties,
    headerStyle: state.headerStyle,
    filters: state.filters.length > 0 ? { operator: "AND" as const, conditions: state.filters.map(toFilterConditionPayload) } : undefined,
    associations:
      state.association && state.association.columns.length > 0
        ? { toObjectType: state.association.toObjectType, columns: state.association.columns }
        : undefined,
    scheduleCron: state.scheduleCron,
    scheduleTz: state.scheduleTz,
    recipients: state.recipients
      .split(/[,\n]/)
      .map((r) => r.trim())
      .filter(Boolean),
  };
}

function canAdvance(step: number, state: BuilderState): boolean {
  if (step === 0) return state.objectType !== null;
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
        body: JSON.stringify(buildPayload(state)),
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
        <CardContent className="py-5">
          {step === 0 && <ObjectTypeStep value={state.objectType} onChange={handleObjectTypeChange} />}

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
              name={state.name}
              onNameChange={(name) => patch({ name })}
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

      {saveError && <p className="text-sm text-destructive">{saveError}</p>}

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canAdvance(step, state)}>
            Next
          </Button>
        ) : (
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save export"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Stepper({ current, onSelect }: { current: number; onSelect: (index: number) => void }) {
  return (
    <ol className="flex flex-wrap gap-2 text-xs">
      {STEPS.map((label, index) => (
        <li key={label}>
          <button
            type="button"
            onClick={() => onSelect(index)}
            aria-current={index === current ? "step" : undefined}
            className={cn(
              "rounded-full border border-border px-2.5 py-1 transition-colors",
              index === current
                ? "border-primary bg-primary text-primary-foreground"
                : index < current
                  ? "text-foreground hover:bg-muted"
                  : "text-muted-foreground",
            )}
          >
            {index + 1}. {label}
          </button>
        </li>
      ))}
    </ol>
  );
}
