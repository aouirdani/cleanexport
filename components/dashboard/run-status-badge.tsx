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

/**
 * Status gets its own palette, not a shade of the one accent color: QUEUED
 * and CANCELLED are deliberately neutral (nothing to act on), RUNNING is
 * amber (in progress, not yet a verdict - the same amber already used for
 * billing/reconnect warnings elsewhere in this shell), SUCCESS is green,
 * FAILED is red and must be legible from across the room. These override
 * the base `variant` colors via `cn` (clsx + tailwind-merge, so the later
 * classes win regardless of the variant's own bg/border/text) rather than
 * relying on the design system's "secondary" variant reading as amber,
 * which it does not - "secondary" and "outline" look the same as every
 * other neutral pill on this screen, which was exactly the complaint.
 * FAILED reuses the --destructive token (border/bg/text-destructive) rather
 * than a separate red, so it matches every other destructive affordance in
 * the app (delete button, error text, "Stalled" badge below) instead of
 * introducing a second, slightly different red.
 */
const STATUS_CLASSNAME: Record<RunStatusValue, string> = {
  QUEUED: "border-border bg-muted text-muted-foreground",
  RUNNING: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  SUCCESS: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  FAILED: "border-destructive/30 bg-destructive/10 text-destructive",
  CANCELLED: "border-border bg-muted text-muted-foreground",
}

/** A small solid dot, colored to match the badge's own status - Stripe's
 *  own status pills carry the state in color + text alone, never a per-
 *  status icon set (Clock/RefreshCw/CircleCheck/... was decoration once the
 *  badge's color and label already say the same thing twice). */
const DOT: Record<RunStatusValue, string> = {
  QUEUED: "bg-muted-foreground/50",
  RUNNING: "bg-amber-500",
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
    <Badge variant={VARIANT[status]} className={cn(STATUS_CLASSNAME[status], "font-medium")}>
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT[status], status === "RUNNING" && "animate-pulse")} />
      {LABEL[status]}
    </Badge>
  )
}
