"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"

/** Mirrors the Prisma SubStatus enum's string values - not imported, same
 *  reasoning as components/dashboard/run-status-badge.tsx's RunStatusValue:
 *  this file is 'use client' and has no business pulling in the generated
 *  Prisma client just for an enum's string values. */
type SubStatusValue = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED"

export interface BillingBannerProps {
  /** Shape matches lib/plan.ts's SubscriptionBannerState - that function is the one place deciding what this says. */
  subscription: {
    status: SubStatusValue
    cancelAtPeriodEnd: boolean
    isLapsed: boolean
    trialDaysRemaining: number | null
    trialEndsAt: Date | string | null
    graceDaysRemaining: number | null
  } | null
}

/**
 * The rule that matters most (learned the hard way once already - see
 * inngest/email.ts and lib/plan.ts's own header comments on the same
 * lesson): this is a 'use client' component, so it must never compute a
 * time-derived value itself. `trialEndsAt` arrives as a plain prop - the
 * server (app/(app)/layout.tsx, via describeSubscriptionForBanner) is the
 * only place that ever reads "now." Formatting a GIVEN date is fine (no
 * clock read); computing "days until X" from Date.now() here would not be.
 */
function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(
    date,
  )
}

/**
 * specs/07-TASKS.md T20: "a trial countdown banner in the dashboard shell."
 * Buttons redirect to Stripe-hosted pages (Checkout, the Customer Portal) -
 * "do not build billing UI" - this component only ever POSTs to
 * /api/billing/checkout or /api/billing/portal and follows the URL they
 * return, exactly like components/logout-button.tsx follows its own
 * server-driven redirect.
 *
 * What the banner OFFERS depends on `subscription.status`, not just what it
 * says - a customer already paying (ACTIVE) must never see a subscribe
 * button, and a customer mid-trial gets one quiet action, not two
 * competing plan buttons. See the per-status render functions below.
 */
export function BillingBanner({ subscription }: BillingBannerProps) {
  const [pending, setPending] = useState<"monthly" | "yearly" | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function goTo(path: "/api/billing/checkout" | "/api/billing/portal", body?: unknown) {
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
      if (!res.ok || !data?.url) {
        setError(data?.error?.message ?? "Could not start billing. Please try again.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  async function subscribe(plan: "monthly" | "yearly") {
    setPending(plan);
    await goTo("/api/billing/checkout", { plan });
  }

  async function openPortal() {
    setPending("portal");
    await goTo("/api/billing/portal");
  }

  // disabled={pending !== null} on every button below: whichever one is
  // shown must not be double-clickable while a checkout/portal request is
  // already in flight (a second click while redirecting must not start a
  // second Stripe session).
  const disabled = pending !== null;

  // Both outline, not one default/primary: the dashboard's one primary
  // (accent) button is "New export" (app/(app)/dashboard/page.tsx) - a
  // banner's own CTA, however important, does not also get to be primary
  // on the same screen. font-semibold is what marks the recommended plan
  // instead of color. Used only where BOTH plan choices are shown side by
  // side (trial expired, canceled) - never for the quiet single-action
  // states below.
  const bothPlanChoices = (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => subscribe("monthly")} disabled={disabled}>
        {pending === "monthly" ? "Redirecting…" : "$29/month"}
      </Button>
      <Button size="sm" variant="outline" className="font-semibold" onClick={() => subscribe("yearly")} disabled={disabled}>
        {pending === "yearly" ? "Redirecting…" : "$290/year"}
      </Button>
    </div>
  );

  const updatePaymentButton = (
    <Button size="sm" variant="outline" onClick={openPortal} disabled={disabled}>
      {pending === "portal" ? "Redirecting…" : "Update payment method"}
    </Button>
  );

  // What's blocked while lapsed - lib/plan.ts's assertWithinPlan enforces
  // exactly this (CREATE_EXPORT/CREATE_SCHEDULE/RUN_EXPORT); existing
  // exports, run history, and downloads are deliberately NOT in this list -
  // a lapsed customer doesn't lose access to what they already have, just
  // the ability to start anything new.
  const BLOCKED = "Creating new exports and running existing ones is paused; scheduled runs won't fire either.";
  const KEEPS = "Your existing exports and run history stay visible, and past files stay downloadable.";

  let content: { message: string; tone: "default" | "warning"; action: React.ReactNode } | null = null;

  if (subscription === null) {
    // Never started checkout - same quiet, single-action treatment as a
    // running trial (there's no known end date yet to state).
    content = {
      message: "Start your 14-day free trial - no charge until it ends.",
      tone: "default",
      action: (
        <Button size="sm" variant="outline" onClick={() => subscribe("monthly")} disabled={disabled}>
          {pending === "monthly" ? "Redirecting…" : "Start free trial"}
        </Button>
      ),
    };
  } else if (subscription.status === "TRIALING" && !subscription.isLapsed) {
    // TRIALING, still running: one quiet secondary action (monthly is the
    // default), yearly tucked behind a small link - never two competing
    // buttons for a customer who hasn't even decided to subscribe yet.
    const days = subscription.trialDaysRemaining;
    const endsPhrase = subscription.trialEndsAt ? ` It ends ${formatDate(subscription.trialEndsAt)}.` : "";
    content = {
      message:
        (days === null ? "You're on a trial." : `${days} day${days === 1 ? "" : "s"} left in your trial.`) +
        endsPhrase,
      tone: "default",
      action: (
        <div className="flex flex-col items-end gap-1">
          <Button size="sm" variant="outline" onClick={() => subscribe("monthly")} disabled={disabled}>
            {pending === "monthly" ? "Redirecting…" : "Add payment method"}
          </Button>
          <button
            type="button"
            onClick={() => subscribe("yearly")}
            disabled={disabled}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            {pending === "yearly" ? "Redirecting…" : "or pay yearly and save two months"}
          </button>
        </div>
      ),
    };
  } else if (subscription.status === "TRIALING") {
    // TRIALING, expired - the only case that deserves prominence.
    content = {
      message: `Your trial has ended. ${BLOCKED}`,
      tone: "warning",
      action: bothPlanChoices,
    };
  } else if (subscription.status === "PAST_DUE") {
    const days = subscription.graceDaysRemaining;
    content = subscription.isLapsed
      ? {
          message: `Your payment is past due and the grace period has ended. ${BLOCKED} Update your payment method to resume.`,
          tone: "warning",
          action: updatePaymentButton,
        }
      : {
          message:
            days === null
              ? "Your last payment failed. Update your payment method to keep your schedules running."
              : `Your last payment failed. You have ${days} day${days === 1 ? "" : "s"} to update your payment method before exports pause.`,
          tone: "warning",
          action: updatePaymentButton,
        };
  } else if (subscription.status === "CANCELED") {
    content = {
      message: `Your subscription was canceled. ${KEEPS} ${BLOCKED}`,
      tone: "warning",
      action: bothPlanChoices,
    };
  }
  // ACTIVE falls through with content still null - see below: no pricing,
  // ever, for a customer already paying. A single quiet "Manage billing"
  // link instead of hiding the banner entirely, so there's always a way
  // back to the Stripe portal without digging through settings.

  if (subscription?.status === "ACTIVE") {
    return (
      <div className="border-b border-border px-4 py-2.5 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-2">
          <button
            type="button"
            onClick={openPortal}
            disabled={disabled}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            {pending === "portal" ? "Redirecting…" : "Manage billing"}
          </button>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    );
  }

  if (!content) return null;

  const tone =
    content.tone === "warning"
      ? "border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10"
      : "border-border bg-muted/40";
  const textTone = content.tone === "warning" ? "text-amber-900 dark:text-amber-200" : "text-foreground";

  return (
    <div className={`border-b px-4 py-2.5 sm:px-6 ${tone}`}>
      <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <p className={`text-[13px] ${textTone}`}>{content.message}</p>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          {content.action}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}
