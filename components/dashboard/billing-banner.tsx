"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"

/** Mirrors the Prisma SubStatus enum's string values - not imported, same
 *  reasoning as components/dashboard/run-status-badge.tsx's RunStatusValue:
 *  this file is 'use client' and has no business pulling in the generated
 *  Prisma client just for an enum's string values. */
type SubStatusValue = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED"

export interface BillingBannerProps {
  subscription: { status: SubStatusValue; trialEndsAt: string | null; cancelAtPeriodEnd: boolean } | null
}

function daysRemaining(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null;
  const ms = new Date(trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
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

  let content: { message: string; tone: "default" | "warning"; action: React.ReactNode } | null = null;

  if (subscription === null) {
    content = {
      message: "Start your 14-day free trial - no charge until it ends.",
      tone: "default",
      action: subscribeButtons,
    };
  } else if (subscription.status === "TRIALING") {
    const days = daysRemaining(subscription.trialEndsAt);
    content = {
      message: days === null ? "You're on a trial." : `${days} day${days === 1 ? "" : "s"} left in your trial.`,
      tone: "default",
      action: subscribeButtons,
    };
  } else if (subscription.status === "PAST_DUE") {
    content = {
      message: "Your last payment failed. Update your payment method to keep your schedules running.",
      tone: "warning",
      action: (
        <Button size="sm" variant="outline" onClick={openPortal} disabled={pending !== null}>
          {pending === "portal" ? "Redirecting…" : "Update payment method"}
        </Button>
      ),
    };
  } else if (subscription.status === "CANCELED") {
    content = {
      message: "Your subscription was canceled.",
      tone: "default",
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
