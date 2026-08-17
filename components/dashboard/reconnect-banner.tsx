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
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/20 dark:bg-amber-500/10 sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <p className="text-sm text-amber-900 dark:text-amber-200">
          Your HubSpot connection was disconnected, so scheduled exports are paused.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="border-amber-300 bg-white text-amber-900 hover:bg-amber-100 dark:border-amber-500/30 dark:bg-transparent dark:text-amber-200"
          render={<a href="/api/auth/hubspot/start" />}
          nativeButton={false}
        >
          Reconnect HubSpot
        </Button>
      </div>
    </div>
  )
}
