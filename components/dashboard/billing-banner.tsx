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
    graceDaysRemaining: number | null
  } | null
}

/**
 * specs/07-TASKS.md T20: "a trial countdown banner in the dashboard shell."
 * Buttons redirect to Stripe-hosted pages (Checkout, the Customer Portal) -
 * "do not build billing UI" - this component only ever POSTs to
 * /api/billing/checkout or /api/billing/portal and follows the URL they
 * return, exactly like components/logout-button.tsx follows its own
 * server-driven redirect.
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

  const subscribeButtons = (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => subscribe("monthly")} disabled={pending !== null}>
        {pending === "monthly" ? "Redirecting…" : "$29/month"}
      </Button>
      <Button size="sm" onClick={() => subscribe("yearly")} disabled={pending !== null}>
        {pending === "yearly" ? "Redirecting…" : "$290/year"}
      </Button>
    </div>
  );

  const updatePaymentButton = (
    <Button size="sm" variant="outline" onClick={openPortal} disabled={pending !== null}>
      {pending === "portal" ? "Redirecting…" : "Update payment method"}
    </Button>
  );

  // What's blocked while lapsed - lib/plan.ts's assertWithinPlan enforces
  // exactly this (CREATE_EXPORT/CREATE_SCHEDULE/RUN_EXPORT); existing
  // exports, run history, and downloads are deliberately NOT in this list
  // (requirement 2 - a lapsed customer doesn't lose access to what they
  // already have, just the ability to start anything new).
  const BLOCKED = "Creating new exports and running existing ones is paused; scheduled runs won't fire either."

  let content: { message: string; tone: "default" | "warning"; action: React.ReactNode } | null = null;

  if (subscription === null) {
    content = {
      message: "Start your 14-day free trial - no charge until it ends.",
      tone: "default",
      action: subscribeButtons,
    };
  } else if (subscription.status === "TRIALING") {
    const days = subscription.trialDaysRemaining;
    content = subscription.isLapsed
      ? { message: `Your trial has ended. ${BLOCKED}`, tone: "warning", action: subscribeButtons }
      : {
          message: days === null ? "You're on a trial." : `${days} day${days === 1 ? "" : "s"} left in your trial.`,
          tone: "default",
          action: subscribeButtons,
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
      message: `Your subscription was canceled. ${BLOCKED}`,
      tone: "warning",
      action: subscribeButtons,
    };
  }

  if (!content) return null; // ACTIVE - nothing to prompt

  const tone =
    content.tone === "warning"
      ? "border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10"
      : "border-border bg-muted/40";
  const textTone = content.tone === "warning" ? "text-amber-900 dark:text-amber-200" : "text-foreground";

  return (
    <div className={`border-b px-4 py-3 sm:px-6 ${tone}`}>
      <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
        <p className={`text-sm ${textTone}`}>{content.message}</p>
        <div className="flex flex-col items-start gap-1 sm:items-end">
          {content.action}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}
