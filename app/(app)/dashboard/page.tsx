/**
 * /dashboard - specs/07-TASKS.md T16. Portal identity and connection status
 * live in the shared app/(app)/layout.tsx; this page is just the overview:
 * the portal's export definitions (read-only - creating/editing them is
 * T17, not built yet) and, for each, its most recent run.
 */
import Link from "next/link"
import { redirect } from "next/navigation"
import { getCurrentSession } from "@/lib/currentPortal"
import { getLatestRunPerExport } from "@/lib/runs"
import { prisma } from "@/lib/db"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { RunStatusBadge, type RunStatusValue } from "@/components/dashboard/run-status-badge"
import { RunNowButton } from "@/components/dashboard/run-now-button"
import { ExportRowActions } from "@/components/dashboard/export-row-actions"
import { formatDateTime, describeSchedule } from "@/components/dashboard/format"
import { Badge } from "@/components/ui/badge"
import { Table2, Plus } from "lucide-react"

export const dynamic = "force-dynamic"

const OBJECT_TYPE_LABEL: Record<string, string> = {
  CONTACTS: "Contacts",
  COMPANIES: "Companies",
  DEALS: "Deals",
  TICKETS: "Tickets",
}

export default async function DashboardPage() {
  const current = await getCurrentSession()
  if (!current.ok) redirect("/")

  // isActive is NOT part of this filter - a paused export (isActive:
  // false) must stay visible with a Resume action, only a soft-deleted
  // one (deletedAt set) actually disappears. See prisma/schema.prisma's
  // ExportDefinition.deletedAt comment for why these are separate fields.
  const exports = await prisma.exportDefinition.findMany({
    where: { portalId: current.portal.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      objectType: true,
      isActive: true,
      scheduleCron: true,
      scheduleTz: true,
      nextRunAt: true,
      recipients: true,
    },
  });

  const latestRuns = await getLatestRunPerExport(
    current.portal.id,
    exports.map((e) => e.id),
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {exports.length === 0
              ? "Nothing exported yet."
              : `${exports.length} export${exports.length === 1 ? "" : "s"} configured.`}
          </p>
        </div>
        {exports.length > 0 && (
          <Button size="sm" render={<Link href="/dashboard/exports/new" />} nativeButton={false}>
            <Plus aria-hidden />
            New export
          </Button>
        )}
      </div>

      {exports.length === 0 ? (
        <EmptyExportsState />
      ) : (
        <div className="flex flex-col gap-3">
          {exports.map((exportDef) => {
            const latest = latestRuns.get(exportDef.id)
            const schedule = describeSchedule(exportDef.scheduleCron, exportDef.nextRunAt)
            return (
              <Card
                key={exportDef.id}
                className="flex flex-col gap-3 px-5 py-4 shadow-sm transition-shadow hover:shadow-md sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {exportDef.name}
                    {!exportDef.isActive && <Badge variant="outline">Paused</Badge>}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                    <span>{OBJECT_TYPE_LABEL[exportDef.objectType] ?? exportDef.objectType}</span>
                    <span aria-hidden>·</span>
                    {schedule === "MANUAL" && <span>Manual only</span>}
                    {schedule === "SCHEDULED" && (
                      <span>
                        {exportDef.isActive ? "Scheduled" : "Schedule paused"} (
                        <span className="font-mono">{exportDef.scheduleTz}</span>)
                      </span>
                    )}
                    {schedule === "INVALID" && <Badge variant="destructive">Schedule needs attention</Badge>}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {exportDef.recipients.length === 0 ? (
                      <Badge variant="destructive">No recipients - runs will fail</Badge>
                    ) : (
                      <>Sends to {exportDef.recipients.join(", ")}</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {latest ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <RunStatusBadge status={latest.status as RunStatusValue} stale={latest.stale} />
                      <span className="font-mono tabular-nums">{formatDateTime(latest.finishedAt ?? latest.createdAt)}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Never run</span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    render={<Link href={`/dashboard/runs?exportId=${exportDef.id}`} />}
                    nativeButton={false}
                  >
                    View runs
                  </Button>
                  <RunNowButton
                    exportId={exportDef.id}
                    latestStatus={latest?.status as RunStatusValue | undefined}
                    latestStale={latest?.stale}
                  />
                  <ExportRowActions exportId={exportDef.id} exportName={exportDef.name} isActive={exportDef.isActive} />
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EmptyExportsState() {
  return (
    <Card className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center shadow-sm sm:py-20">
      <div
        aria-hidden
        className="mb-6 grid size-12 place-items-center rounded-xl border border-border bg-muted"
      >
        <Table2 className="size-5 text-muted-foreground" strokeWidth={1.75} />
      </div>
      <h2 className="text-3xl font-semibold tracking-tight">No exports yet</h2>
      <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
        An export is a saved definition of <span className="font-medium text-foreground">which properties</span>{" "}
        leave your portal, <span className="font-medium text-foreground">how they&apos;re formatted</span>, and{" "}
        <span className="font-medium text-foreground">how often</span> they run. Create one and it ships on
        schedule without you.
      </p>
      <div className="mt-7">
        <Button size="lg" render={<Link href="/dashboard/exports/new" />} nativeButton={false}>
          <Plus aria-hidden />
          Create your first export
        </Button>
      </div>
    </Card>
  )
}
