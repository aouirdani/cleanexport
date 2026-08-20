import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

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

/** A small solid dot, colored to match the badge's own variant - Stripe's
 *  own status pills carry the state in color + text alone, never a per-
 *  status icon set (Clock/RefreshCw/CircleCheck/... was decoration once the
 *  badge's color and label already say the same thing twice). */
const DOT: Record<RunStatusValue, string> = {
  QUEUED: "bg-muted-foreground/50",
  RUNNING: "bg-foreground/60",
  SUCCESS: "bg-emerald-500",
  FAILED: "bg-destructive",
  CANCELLED: "bg-muted-foreground/50",
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
        <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
        Stalled
      </Badge>
    )
  }

  return (
    <Badge variant={VARIANT[status]}>
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT[status], status === "RUNNING" && "animate-pulse")} />
      {LABEL[status]}
    </Badge>
  )
}
