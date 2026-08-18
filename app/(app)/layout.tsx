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
import { BillingBanner } from "@/components/dashboard/billing-banner"

export const dynamic = "force-dynamic"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const current = await getCurrentSession()
  if (!current.ok) redirect("/")

  const { portal, subscription } = current
  const isDisconnected = portal.disconnectedAt !== null
  // portal.hubDomain is a bare domain OR a full URL, depending on what
  // HubSpot's token-introspection response happened to contain - normalize
  // both so the visible label never leaks a scheme and a link always gets a
  // usable href, instead of concatenating it straight into the status pill
  // (previously: domain text and the "Connected"/"Disconnected" word shared
  // one unspaced run of text, e.g. "https://www.kitchenbylola.comConnected").
  const portalDomain = portal.hubDomain?.replace(/^https?:\/\//, "") ?? null
  const portalUrl = portalDomain ? `https://${portalDomain}` : null
  const portalLabel = portal.name ?? portalDomain ?? "your HubSpot portal"

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/80">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
              <span
                aria-hidden
                className="grid size-6 place-items-center rounded-md bg-foreground text-[11px] font-bold text-background"
              >
                CE
              </span>
              CleanExport
            </span>
            <nav className="flex items-center gap-1 text-[13px]">
              <Link
                href="/dashboard"
                className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Dashboard
              </Link>
              <Link
                href="/dashboard/runs"
                className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Run history
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            {portalUrl ? (
              <a
                href={portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden text-xs text-muted-foreground hover:text-foreground hover:underline sm:inline"
              >
                {portalLabel}
              </a>
            ) : (
              <span className="hidden text-xs text-muted-foreground sm:inline">{portalLabel}</span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
              <span
                className={`size-1.5 rounded-full ${isDisconnected ? "bg-destructive" : "bg-emerald-500"}`}
                aria-hidden
              />
              {isDisconnected ? "Disconnected" : "Connected"}
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>

      {isDisconnected && <ReconnectBanner />}

      <BillingBanner
        subscription={
          subscription
            ? { ...subscription, trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null }
            : null
        }
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
