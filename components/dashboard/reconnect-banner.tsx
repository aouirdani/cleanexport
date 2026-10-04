import { Button } from "@/components/ui/button"

/**
 * specs/07-TASKS.md T16: "a disconnected portal shows a reconnect banner,
 * not a generic error." Rendered from app/(app)/layout.tsx on every page in
 * the dashboard shell, not just the ones that happen to hit an error - a
 * disconnected portal is a persistent state, not a one-off failure.
 * No 'use client' needed: this is a plain link to the existing OAuth start
 * route (which re-runs the HubSpot flow and clears `disconnectedAt` on
 * success - app/api/auth/hubspot/callback/route.ts), not a fetch call.
 */
export function ReconnectBanner() {
  /* --warning carries its own light/dark mapping now, so this no longer
     needs a parallel set of dark: amber-* overrides - the token does that
     job. */
  return (
    <div className="border-b border-warning/30 bg-warning/10 px-4 py-2.5 sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <p className="text-status text-warning">
          Your HubSpot connection was disconnected, so scheduled exports are paused.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="border-warning/40 bg-card text-warning hover:bg-warning/10"
          render={<a href="/api/auth/hubspot/start" />}
          nativeButton={false}
        >
          Reconnect HubSpot
        </Button>
      </div>
    </div>
  )
}
