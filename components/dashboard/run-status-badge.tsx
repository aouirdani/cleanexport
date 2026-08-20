import { Clock, RefreshCw, CircleCheck, CircleX, CircleSlash, TriangleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"

/**
 * A plain string union, not the Prisma `RunStatus` enum: this file is
 * imported from components/dashboard/runs-table.tsx ('use client'), and
 * pulling Prisma's generated client into the browser bundle just for an
 * enum's string values would be pure bloat. The values are identical to
 * `RunStatus` by construction - see lib/runs.ts, the one place that reads
 * the real enum from Prisma.
 */
export type RunStatusValue = "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED"

const LABEL: Record<RunStatusValue, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  SUCCESS: "Success",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
}

const VARIANT: Record<RunStatusValue, "success" | "destructive" | "secondary" | "outline"> = {
  QUEUED: "outline",
  RUNNING: "secondary",
  SUCCESS: "success",
  FAILED: "destructive",
  CANCELLED: "outline",
}

const ICON: Record<RunStatusValue, typeof Clock> = {
  QUEUED: Clock,
  RUNNING: RefreshCw,
  SUCCESS: CircleCheck,
  FAILED: CircleX,
  CANCELLED: CircleSlash,
}

/**
 * `stale` overrides the QUEUED/RUNNING display with a distinct "Stalled"
 * badge - the underlying DB status is still QUEUED/RUNNING until
 * inngest/staleRuns.ts's cron (or app/api/exports/[id]/run/route.ts, on the
 * next "Run now" click) gets around to marking it FAILED, but the dashboard
 * must not go on calling a run over 30 minutes old "Queued"/"Running" as if
 * it were still in progress (requirement 1).
 */
export function RunStatusBadge({ status, stale = false }: { status: RunStatusValue; stale?: boolean }) {
  if (stale && (status === "QUEUED" || status === "RUNNING")) {
    return (
      <Badge variant="destructive">
        <TriangleAlert aria-hidden />
        Stalled
      </Badge>
    )
  }

  const Icon = ICON[status]
  return (
    <Badge variant={VARIANT[status]}>
      <Icon aria-hidden className={status === "RUNNING" ? "animate-spin" : undefined} />
      {LABEL[status]}
    </Badge>
  )
}
