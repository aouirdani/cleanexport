/**
 * app/(app) - the authenticated dashboard shell (specs/07-TASKS.md T16).
 * Wraps every route under it (currently /dashboard and /dashboard/runs)
 * with nav, portal identity, and the reconnect banner, so those concerns
 * live in exactly one place instead of being repeated per page.
 *
 * A server component: it reads the session via getCurrentSession()
 * (cookies() + one DB round trip, cached per request), no client-side data
 * fetching for anything that isn't interactive.
 */
import { redirect } from "next/navigation"
import Link from "next/link"
import { getCurrentSession } from "@/lib/currentPortal"
import { LogoutButton } from "@/components/logout-button"
import { ReconnectBanner } from "@/components/dashboard/reconnect-banner"

export const dynamic = "force-dynamic"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const current = await getCurrentSession()
  if (!current.ok) redirect("/")

  const { portal } = current
  const isDisconnected = portal.disconnectedAt !== null
  const portalLabel = portal.name ?? portal.hubDomain ?? "your HubSpot portal"

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold tracking-tight">CleanExport</span>
            <nav className="flex items-center gap-4 text-sm text-muted-foreground">
              <Link href="/dashboard" className="hover:text-foreground">
                Dashboard
              </Link>
              <Link href="/dashboard/runs" className="hover:text-foreground">
                Run history
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span
                className={`size-1.5 rounded-full ${isDisconnected ? "bg-destructive" : "bg-emerald-500"}`}
                aria-hidden
              />
              <span className="hidden sm:inline">{portalLabel}</span>
              <span>{isDisconnected ? "Disconnected" : "Connected"}</span>
            </div>
            <LogoutButton />
          </div>
        </div>
      </header>

      {isDisconnected && <ReconnectBanner />}

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
