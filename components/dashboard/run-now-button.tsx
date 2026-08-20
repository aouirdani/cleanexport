"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import type { RunStatusValue } from "@/components/dashboard/run-status-badge"

/**
 * specs/07-TASKS.md: "a 'Run now' button on each export row... navigates to
 * /dashboard/runs?exportId=... so the user immediately sees the run they
 * just started, polling until it settles." That polling is
 * components/dashboard/runs-table.tsx's own job (T19) - this component's
 * job ends at the navigation.
 *
 * "disables while a run for that export is QUEUED or RUNNING": the initial
 * disabled state comes from `latestStatus`, a prop from the dashboard's own
 * server-rendered latest-run-per-export data (lib/runs.ts's
 * getLatestRunPerExport) - no extra fetch on mount just to learn what the
 * page already knew. It's a starting point, not a live subscription: this
 * button does not poll. A currently-running export shows the disabled
 * state as of the last page load/navigation, same as every other value
 * on this page.
 *
 * `latestStale`: a QUEUED/RUNNING run older than lib/runs.ts's STALE_RUN_MS
 * (30 minutes) is NOT treated as in-flight - a lost export.run.requested
 * event used to leave this button permanently disabled with no way out.
 * The API route itself re-validates this independently (never trust a
 * disabled state alone to prevent a duplicate run) and fails the stale row
 * inline before starting the new one.
 */
export function RunNowButton({
  exportId,
  latestStatus,
  latestStale = false,
}: {
  exportId: string
  latestStatus?: RunStatusValue
  latestStale?: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const alreadyInFlight = !latestStale && (latestStatus === "QUEUED" || latestStatus === "RUNNING")
  const disabled = pending || alreadyInFlight

  async function handleRun() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/exports/${exportId}/run`, { method: "POST" })
      const body = (await res.json().catch(() => null)) as { runId?: string; error?: { message?: string } } | null;
      if (!res.ok || !body?.runId) {
        setError(body?.error?.message ?? "Could not start this export. Please try again.");
        setPending(false);
        return;
      }
      router.push(`/dashboard/runs?exportId=${exportId}`);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={handleRun} disabled={disabled}>
        {pending ? "Starting…" : alreadyInFlight ? "Running…" : "Run now"}
      </Button>
      {/* specs/07-TASKS.md: "when the plan limit is hit, say which limit and
          when it resets - not a generic error." lib/plan.ts's PLAN_LIMIT_REACHED
          message already says exactly that; this just surfaces it verbatim
          rather than replacing it with a generic "something went wrong". */}
      {error && <p className="max-w-48 text-right text-xs text-destructive">{error}</p>}
    </div>
  );
}
