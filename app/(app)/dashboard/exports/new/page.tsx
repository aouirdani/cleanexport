/**
 * /dashboard/exports/new - specs/07-TASKS.md T17. A server component only
 * for the session check/redirect (matches app/(app)/dashboard/page.tsx and
 * .../runs/page.tsx); the builder itself is inherently interactive
 * (multi-step, search, drag-and-drop) so it's a client component tree from
 * here down. portalId is never passed to it - every request it makes
 * (GET /api/properties/:objectType, POST /api/exports) resolves portalId
 * from the session cookie itself.
 */
import { redirect } from "next/navigation"
import { getCurrentSession } from "@/lib/currentPortal"
import { ExportBuilder } from "@/components/exports/export-builder"

export const dynamic = "force-dynamic"

export default async function NewExportPage() {
  const current = await getCurrentSession();
  if (!current.ok) redirect("/");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">New export</h1>
        <p className="text-sm text-muted-foreground">
          Pick an object type, choose properties, and get a clean Excel file - on a schedule if you want one.
        </p>
      </div>
      <ExportBuilder />
    </div>
  );
}
