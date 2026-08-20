/**
 * /dashboard/runs - specs/07-TASKS.md T19: "Table of last 30 runs, status
 * badge, row count, re-download, error message shown in full."
 *
 * Initial data is fetched server-side via lib/runs.ts (no client round trip
 * for first paint); RunsTable ('use client') takes over polling only if a
 * run is still QUEUED or RUNNING.
 */
import Link from "next/link"
import { redirect } from "next/navigation"
import { getCurrentSession } from "@/lib/currentPortal"
import { listRuns } from "@/lib/runs"
import { prisma } from "@/lib/db"
import { RunsTable, type RunRow } from "@/components/dashboard/runs-table"
import { Button } from "@/components/ui/button"
import { X } from "lucide-react"

export const dynamic = "force-dynamic"

function toRunRow(run: Awaited<ReturnType<typeof listRuns>>[number]): RunRow {
  return {
    id: run.id,
    exportId: run.exportId,
    exportName: run.exportName,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    rowCount: run.rowCount,
    fileSizeBytes: run.fileSizeBytes,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt.toISOString(),
    stale: run.stale,
  }
}

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ exportId?: string }>
}) {
  const current = await getCurrentSession()
  if (!current.ok) redirect("/")

  const { exportId } = await searchParams

  const [runs, filteredExport] = await Promise.all([
    listRuns(current.portal.id, { exportId }),
    exportId
      ? prisma.exportDefinition.findFirst({
          where: { id: exportId, portalId: current.portal.id },
          select: { name: true },
        })
      : Promise.resolve(null),
  ])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.015em]">Run history</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          The last {runs.length === 30 ? 30 : runs.length} runs.
        </p>
      </div>

      {exportId && (
        <div className="flex items-center gap-1.5 self-start rounded-full border border-border py-1 pr-1 pl-3 text-xs text-muted-foreground">
          <span>
            Filtered to <span className="text-foreground">{filteredExport?.name ?? "an export"}</span>
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            className="rounded-full"
            render={<Link href="/dashboard/runs" aria-label="Clear filter" />}
            nativeButton={false}
          >
            <X />
          </Button>
        </div>
      )}

      <RunsTable initialRuns={runs.map(toRunRow)} exportId={exportId} />
    </div>
  )
}
