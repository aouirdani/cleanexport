"use client"

import { useEffect, useState } from "react"
import { RunStatusBadge, type RunStatusValue } from "@/components/dashboard/run-status-badge"
import { formatDateTime, formatRowCount } from "@/components/dashboard/format"
import { Button } from "@/components/ui/button"

export interface RunRow {
  id: string
  exportId: string
  exportName: string
  status: RunStatusValue
  trigger: string
  startedAt: string | null
  finishedAt: string | null
  rowCount: number | null
  fileSizeBytes: number | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
}

const POLL_INTERVAL_MS = 4000
const IN_FLIGHT_STATUSES: RunStatusValue[] = ["QUEUED", "RUNNING"]

/**
 * specs/07-TASKS.md T19: "A QUEUED or RUNNING row polls until it settles."
 * Initial data is server-rendered (app/(app)/dashboard/runs/page.tsx fetches
 * it directly via lib/runs.ts, no client round trip needed for first paint)
 * - this component only takes over once there's something in flight to
 * watch, and stops the moment there isn't, rather than polling forever.
 */
export function RunsTable({ initialRuns, exportId }: { initialRuns: RunRow[]; exportId?: string }) {
  const [runs, setRuns] = useState(initialRuns)
  const hasInFlight = runs.some((run) => IN_FLIGHT_STATUSES.includes(run.status))

  useEffect(() => {
    if (!hasInFlight) return

    const query = exportId ? `?exportId=${encodeURIComponent(exportId)}` : ""
    let cancelled = false

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/runs${query}`, { cache: "no-store" })
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { runs: RunRow[] }
        if (!cancelled) setRuns(data.runs)
      } catch {
        // A dropped poll just tries again on the next tick - no need to surface it.
      }
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
    // Re-armed only when whether-anything-is-in-flight changes, not on every
    // `runs` update - otherwise each poll response would tear down and
    // recreate its own interval.
  }, [hasInFlight, exportId])

  if (runs.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No runs yet. Runs you trigger manually or on a schedule will show up here.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <th className="py-2 pr-4 font-medium">Export</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-4 font-medium">Started</th>
            <th className="py-2 pr-4 font-medium">Rows</th>
            <th className="py-2 pr-4 font-medium">Trigger</th>
            <th className="py-2 pr-0 font-medium text-right">File</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <RunRowView key={run.id} run={run} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RunRowView({ run }: { run: RunRow }) {
  return (
    <>
      <tr className="border-b border-border/60 align-top last:border-0">
        <td className="py-3 pr-4 font-medium">{run.exportName}</td>
        <td className="py-3 pr-4">
          <RunStatusBadge status={run.status} />
        </td>
        <td className="py-3 pr-4 whitespace-nowrap text-muted-foreground">
          {formatDateTime(run.startedAt ?? run.createdAt)}
        </td>
        <td className="py-3 pr-4 whitespace-nowrap text-muted-foreground">{formatRowCount(run.rowCount)}</td>
        <td className="py-3 pr-4 whitespace-nowrap text-muted-foreground">
          {run.trigger === "SCHEDULE" ? "Schedule" : "Manual"}
        </td>
        <td className="py-3 pr-0 text-right">
          {run.status === "SUCCESS" && (
            <Button
              size="sm"
              variant="outline"
              render={<a href={`/api/runs/${run.id}/download`} target="_blank" rel="noopener noreferrer" />}
              nativeButton={false}
            >
              Download
            </Button>
          )}
        </td>
      </tr>
      {run.status === "FAILED" && run.errorMessage && <RunErrorRow message={run.errorMessage} />}
    </>
  )
}

/**
 * specs/07-TASKS.md T19: "the error message shown in FULL, not truncated -
 * a customer debugging a failed Monday export needs the whole thing." No
 * `truncate` class, no line clamp, no client-side slicing - `whitespace-pre-wrap`
 * so embedded newlines still render instead of collapsing to spaces.
 */
function RunErrorRow({ message }: { message: string }) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td colSpan={6} className="pb-3 pr-4">
        <p className="rounded-md bg-destructive/5 px-3 py-2 text-xs whitespace-pre-wrap text-destructive">
          {message}
        </p>
      </td>
    </tr>
  )
}
