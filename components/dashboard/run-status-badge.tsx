import { Clock, RefreshCw, CircleCheck, CircleX, CircleSlash } from "lucide-react"
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

export function RunStatusBadge({ status }: { status: RunStatusValue }) {
  const Icon = ICON[status]
  return (
    <Badge variant={VARIANT[status]}>
      <Icon aria-hidden className={status === "RUNNING" ? "animate-spin" : undefined} />
      {LABEL[status]}
    </Badge>
  )
}
