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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { RunStatusBadge, type RunStatusValue } from "@/components/dashboard/run-status-badge"
import { formatDateTime } from "@/components/dashboard/format"

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

  const exports = await prisma.exportDefinition.findMany({
    where: { portalId: current.portal.id, isActive: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, objectType: true, scheduleCron: true, scheduleTz: true },
  });

  const latestRuns = await getLatestRunPerExport(
    current.portal.id,
    exports.map((e) => e.id),
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {exports.length === 0
            ? "Nothing exported yet."
            : `${exports.length} export${exports.length === 1 ? "" : "s"} configured.`}
        </p>
      </div>

      {exports.length === 0 ? (
        <EmptyExportsState />
      ) : (
        <div className="flex flex-col gap-3">
          {exports.map((exportDef) => {
            const latest = latestRuns.get(exportDef.id)
            return (
              <Card key={exportDef.id}>
                <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">{exportDef.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {OBJECT_TYPE_LABEL[exportDef.objectType] ?? exportDef.objectType} ·{" "}
                      {exportDef.scheduleCron ? `Scheduled (${exportDef.scheduleTz})` : "Manual only"}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {latest ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <RunStatusBadge status={latest.status as RunStatusValue} />
                        <span>{formatDateTime(latest.finishedAt ?? latest.createdAt)}</span>
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
                  </div>
                </CardContent>
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
    <Card>
      <CardHeader>
        <CardTitle>No exports yet</CardTitle>
        <CardDescription>
          Create an export to pick an object type, choose properties, and get a clean Excel
          file delivered on a schedule.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button render={<Link href="/dashboard/exports/new" />} nativeButton={false}>
          Create your first export
        </Button>
      </CardContent>
    </Card>
  )
}
