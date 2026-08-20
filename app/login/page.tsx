/**
 * /login - defect #4: "a failed OAuth redirects to /login?error=... which
 * returns 404." app/api/auth/hubspot/callback/route.ts's `fail()` helper
 * already redirects here with one of exactly four `error` values (see that
 * file) - this page just has to exist, read the param, and say plainly what
 * happened, always with a working way to try again.
 *
 * A server component: `error` is a search param, not session-dependent
 * state, so there's nothing here that needs a DB round trip or a client
 * component - a plain Link/anchor to the OAuth start route is enough.
 */
import { Button } from "@/components/ui/button"

export const dynamic = "force-dynamic"

/**
 * Exactly the four values app/api/auth/hubspot/callback/route.ts's `fail()`
 * can send - an unrecognised or missing `error` falls back to the same
 * plain "something went wrong" copy as `missing_code`, never a blank page.
 */
const ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: "The sign-in took too long, so we couldn't confirm it was you. Try connecting again.",
  exchange_failed: "HubSpot rejected the connection. Try again - if it keeps happening, let us know.",
  denied: "You cancelled the HubSpot connection. Connect again whenever you're ready.",
  missing_code: "Something went wrong during sign-in. Try again.",
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams
  const message = error ? (ERROR_MESSAGES[error] ?? ERROR_MESSAGES.missing_code) : null

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-background px-6 py-20 text-foreground">
      <div className="flex w-full max-w-sm flex-col items-center gap-6">
        <span className="text-sm font-semibold tracking-tight">CleanExport</span>

        {message && (
          <div
            role="alert"
            className="w-full rounded-lg border border-border bg-card px-4 py-3 text-center text-sm text-muted-foreground"
          >
            {message}
          </div>
        )}

        <Button
          className="h-11 w-full px-6 text-base"
          render={<a href="/api/auth/hubspot/start" />}
          nativeButton={false}
        >
          Connect HubSpot
        </Button>
      </div>
    </div>
  )
}
