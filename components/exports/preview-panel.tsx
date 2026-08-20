"use client"

import { useState } from "react"
import { buildExportPayload, canPreview } from "@/components/exports/payload"
import type { BuilderState } from "@/components/exports/types"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Mirrors lib/exportPreview.ts's PreviewColumn/PreviewCellValue - a plain
 * local type, not imported: that module pulls in HubSpotClient and friends,
 * which have no business in a client bundle. Same reasoning as
 * components/dashboard/run-status-badge.tsx's RunStatusValue.
 */
type PreviewColumnType = "text" | "number" | "date" | "datetime" | "boolean"
type PreviewCellValue = string | number | boolean | null
interface PreviewColumn {
  key: string
  header: string
  type: PreviewColumnType
}
interface PreviewResponse {
  columns: PreviewColumn[]
  sampleRows: PreviewCellValue[][]
}

/**
 * specs/07-TASKS.md T18: "a user should see the file is correct before
 * committing to a schedule." Rendered persistently below the step card
 * (export-builder.tsx), not gated to one wizard step, so it's usable as
 * soon as there's enough to preview and stays available through every
 * later step (filters, associations, schedule) as the user refines them.
 */
export function PreviewPanel({ state }: { state: BuilderState }) {
  const [result, setResult] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const ready = canPreview(state);

  async function handlePreview() {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/exports/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildExportPayload(state)),
      });
      const body = (await res.json().catch(() => null)) as PreviewResponse | { error: { message: string } } | null;
      if (!res.ok || !body || !("columns" in body)) {
        const message = body && "error" in body ? body.error.message : "Could not build a preview. Please try again.";
        setError(message);
        setResult(null);
        return;
      }
      setResult(body);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-medium">Preview</h3>
          <p className="text-xs text-muted-foreground">
            Up to 20 real rows, run through the exact same pipeline as a real export.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={handlePreview} disabled={!ready || loading}>
          {loading ? "Loading…" : "Preview"}
        </Button>
      </div>

      {!ready && (
        <p className="text-xs text-muted-foreground">Name the export, pick an object type, and select at least one property to preview it.</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && <PreviewTable columns={result.columns} sampleRows={result.sampleRows} />}
    </div>
  );
}

function formatPreviewValue(value: PreviewCellValue, type: PreviewColumnType): string {
  if (value === null) return "";
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "number") return typeof value === "number" ? value.toLocaleString("en-US") : String(value);
  if (type === "date") return typeof value === "string" ? value.slice(0, 10) : String(value);
  if (type === "datetime") return typeof value === "string" ? value.replace("T", " ").slice(0, 16) : String(value);
  return String(value);
}

function PreviewTable({ columns, sampleRows }: PreviewResponse) {
  if (sampleRows.length === 0) {
    // specs/07-TASKS.md T18: "an empty result says '0 records matched your
    // filters', never a blank table with no explanation."
    return (
      <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        0 records matched your filters.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-max text-left text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {columns.map((col) => (
              <th key={col.key} className="whitespace-nowrap px-2.5 py-2 align-bottom font-medium">
                <div className="text-[13px]">{col.header}</div>
                {/* specs/07-TASKS.md T18: "each header shows the column's type." */}
                <div className="text-[10px] font-normal tracking-wider text-muted-foreground uppercase">{col.type}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sampleRows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/30">
              {row.map((value, colIndex) => {
                const type = columns[colIndex].type;
                return (
                  <td
                    key={colIndex}
                    // specs/07-TASKS.md T18: "multi-line values render with
                    // their line breaks visible" - whitespace-pre-wrap
                    // preserves a real \n as a real line break, the entire
                    // point of the product (specs/05-EXPORT-ENGINE.md section 3).
                    // Numbers/dates get the monospace/tabular treatment -
                    // text values don't.
                    className={cn(
                      "max-w-xs px-2.5 py-2 align-top whitespace-pre-wrap",
                      (type === "number" || type === "date" || type === "datetime") && "font-mono tabular-nums",
                    )}
                  >
                    {formatPreviewValue(value, type)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
