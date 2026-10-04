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
 * Status gets its own palette, not a shade of the one accent color - and
 * now each status has its own pair of a text color AND a quiet surface
 * (--success/--success-surface, --danger/--danger-surface, --warning/
 * --warning-surface, --info/--info-surface), not one hue reused at
 * different opacities over --muted. Five statuses, four pairs:
 *   SUCCESS -> success (green)
 *   FAILED  -> danger (red) - "a failed run must be identifiable from
 *              across the room without reading it"
 *   RUNNING -> warning (amber, in progress, not yet a verdict)
 *   QUEUED  -> info (blue, something pending - a real color, not grey,
 *              since "nothing is wrong" still deserves its own signal)
 *   CANCELLED -> genuinely neutral (border/muted/muted-foreground) - the
 *              one truly inert, no-valence end state, so it's the one
 *              status that does NOT get one of the four new hues.
 * --danger reuses --destructive's own red rather than a second one (see
 * globals.css) so this badge and every other destructive affordance in
 * the app share one hue. These override the base `variant` colors via
 * `cn` (clsx + tailwind-merge, so the later classes win regardless of the
 * variant's own bg/border/text) rather than relying on the design
 * system's "secondary"/"outline" variants reading as these colors, which
 * they do not. A SUCCESS badge never depends on anything else about the
 * run (row count included) - "Succeeded · 0 rows" is still SUCCESS green;
 * it's the dashboard's own "Not run yet" text (plain, no badge at all)
 * that carries absence, never this component degrading a real status to
 * look neutral. Word label + colored dot both stay on every badge - color
 * is never the only signal.
 */
const STATUS_CLASSNAME: Record<RunStatusValue, string> = {
  QUEUED: "border-info/30 bg-info-surface text-info",
  RUNNING: "border-warning/30 bg-warning-surface text-warning",
  SUCCESS: "border-success/30 bg-success-surface text-success",
  FAILED: "border-danger/30 bg-danger-surface text-danger",
  CANCELLED: "border-border bg-muted text-muted-foreground",
}

/** A small solid dot, colored to match the badge's own status - Stripe's
 *  own status pills carry the state in color + text alone, never a per-
 *  status icon set (Clock/RefreshCw/CircleCheck/... was decoration once the
 *  badge's color and label already say the same thing twice). */
const DOT: Record<RunStatusValue, string> = {
  QUEUED: "bg-info",
  RUNNING: "bg-warning",
  SUCCESS: "bg-success",
  FAILED: "bg-danger",
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
    // A stalled run is heading for FAILED (inngest/staleRuns.ts marks it so
    // on its next pass) - it gets the same danger pair as FAILED itself,
    // not the generic destructive variant, so the two read as one family.
    return (
      <Badge variant="outline" className="border-danger/30 bg-danger-surface text-danger text-status font-medium">
        <span aria-hidden className="size-1.5 rounded-full bg-danger" />
        Stalled
      </Badge>
    )
  }

  return (
    <Badge variant={VARIANT[status]} className={cn(STATUS_CLASSNAME[status], "text-status font-medium")}>
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT[status], status === "RUNNING" && "animate-pulse")} />
      {LABEL[status]}
    </Badge>
  )
}
