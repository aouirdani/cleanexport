"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogClose,
} from "@/components/ui/alert-dialog"
import { Trash2 } from "lucide-react"

/**
 * The gap this closes: an export with a schedule had no way to be stopped
 * or removed from the dashboard - a runaway schedule could only be fixed
 * with a database script. Two independent actions, both PATCH/DELETE
 * /api/exports/:id (app/api/exports/[id]/route.ts):
 *   - Pause/resume: reversible, one click, no confirmation - flips
 *     `isActive`. Stops export.schedule.tick from selecting this export
 *     (its own query filters on `isActive`) without touching anything
 *     else about the definition.
 *   - Delete: NOT reversible from the UI (a soft delete server-side, but
 *     there is no "undelete" button), so it's gated behind a confirmation
 *     naming the export - the same reasoning as any destructive action
 *     with no undo: a slip of the mouse must not be able to do this.
 *
 * Both call `router.refresh()` on success rather than mutating local
 * state - the dashboard page is a server component reading straight from
 * Prisma (app/(app)/dashboard/page.tsx), and refetching it is what keeps
 * this row's data (and every other row's) honest after either action,
 * exactly like components/dashboard/run-now-button.tsx's own navigation
 * pattern.
 */
export function ExportRowActions({
  exportId,
  exportName,
  isActive,
}: {
  exportId: string
  exportName: string
  isActive: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState<"toggle" | "delete" | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleToggle() {
    setPending("toggle")
    setError(null)
    try {
      const res = await fetch(`/api/exports/${exportId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !isActive }),
      })
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      if (!res.ok) {
        setError(body?.error?.message ?? "Could not update this export. Please try again.")
        return
      }
      router.refresh()
    } catch {
      setError("Could not reach the server. Check your connection and try again.")
    } finally {
      setPending(null)
    }
  }

  async function handleDelete() {
    setPending("delete")
    setError(null)
    try {
      const res = await fetch(`/api/exports/${exportId}`, { method: "DELETE" })
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      if (!res.ok) {
        setError(body?.error?.message ?? "Could not delete this export. Please try again.")
        return
      }
      router.refresh()
    } catch {
      setError("Could not reach the server. Check your connection and try again.")
    } finally {
      setPending(null)
    }
  }

  const disabled = pending !== null

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={handleToggle} disabled={disabled}>
          {pending === "toggle" ? "Working…" : isActive ? "Pause" : "Resume"}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger
            render={<Button size="icon-sm" variant="ghost" disabled={disabled} aria-label={`Delete ${exportName}`} />}
          >
            <Trash2 />
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete &ldquo;{exportName}&rdquo;?</AlertDialogTitle>
              <AlertDialogDescription>
                This stops its schedule and removes it from your dashboard. Past runs and downloaded files are
                not affected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="outline" disabled={disabled} />}>Cancel</AlertDialogClose>
              <AlertDialogClose render={<Button variant="destructive" onClick={handleDelete} disabled={disabled} />}>
                {pending === "delete" ? "Deleting…" : "Delete"}
              </AlertDialogClose>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {error && <p className="max-w-48 text-right text-xs text-destructive">{error}</p>}
    </div>
  )
}
