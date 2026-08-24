// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BillingBanner } from "@/components/dashboard/billing-banner";

// What the banner OFFERS must depend on subscription.status, not just what
// it says - a customer already paying (ACTIVE) must never see a subscribe
// button or a price, and a customer mid-trial gets ONE quiet action, never
// two competing plan buttons.

function base(overrides: Partial<NonNullable<React.ComponentProps<typeof BillingBanner>["subscription"]>>) {
  return {
    status: "TRIALING" as const,
    cancelAtPeriodEnd: false,
    isLapsed: false,
    trialDaysRemaining: null,
    trialEndsAt: null,
    graceDaysRemaining: null,
    ...overrides,
  };
}

describe("BillingBanner", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("no subscription (never checked out): one quiet action, no price buttons", () => {
    render(<BillingBanner subscription={null} />);

    expect(screen.getByRole("button", { name: "Start free trial" })).toBeInTheDocument();
    expect(screen.queryByText("$29/month")).not.toBeInTheDocument();
    expect(screen.queryByText("$290/year")).not.toBeInTheDocument();
  });

  it("TRIALING, still running: states days remaining and the end date, one quiet PRIMARY action, yearly behind a small TEXT LINK (not a second button) - never two price buttons", () => {
    render(
      <BillingBanner
        subscription={base({
          isLapsed: false,
          trialDaysRemaining: 5,
          trialEndsAt: new Date("2026-08-26T00:00:00Z"),
        })}
      />,
    );

    expect(screen.getByText(/5 days left in your trial/)).toBeInTheDocument();
    expect(screen.getByText(/Aug 26, 2026/)).toBeInTheDocument();

    const monthlyButton = screen.getByRole("button", { name: "Add payment method" });
    const yearlyLink = screen.getByText("or pay yearly and save two months");

    // "One quiet primary action... yearly behind a SMALL TEXT LINK" is a
    // structural claim, not just a copy claim: a presence-only check (does
    // *something* named "Add payment method" exist) would still pass if a
    // future change turned the yearly option into a second real Button, or
    // demoted the monthly action to a plain link - neither of which is
    // "one primary action and a small link." The monthly action must go
    // through our actual Button primitive (data-slot="button"); the yearly
    // option must not.
    expect(monthlyButton).toHaveAttribute("data-slot", "button");
    expect(yearlyLink.tagName).toBe("BUTTON"); // still a real, clickable <button> for accessibility...
    expect(yearlyLink).not.toHaveAttribute("data-slot", "button"); // ...but not promoted to the primary Button primitive

    // Not two competing priced buttons.
    expect(screen.queryByText("$29/month")).not.toBeInTheDocument();
    expect(screen.queryByText("$290/year")).not.toBeInTheDocument();
  });

  it("TRIALING, still running: clicking each action posts the RIGHT plan - a button that merely LOOKS right (correct label, wrong handler) is exactly as broken as a missing one", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: "https://checkout.stripe.com/x" }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(
      <BillingBanner
        subscription={base({ isLapsed: false, trialDaysRemaining: 5, trialEndsAt: new Date("2026-08-26T00:00:00Z") })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add payment method" }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/billing/checkout",
      expect.objectContaining({ body: JSON.stringify({ plan: "monthly" }) }),
    );

    await user.click(screen.getByText("or pay yearly and save two months"));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/billing/checkout",
      expect.objectContaining({ body: JSON.stringify({ plan: "yearly" }) }),
    );
  });

  it("TRIALING, expired: states exports stopped, shows BOTH plan choices clearly priced", () => {
    render(<BillingBanner subscription={base({ isLapsed: true, trialDaysRemaining: -2 })} />);

    expect(screen.getByText(/Your trial has ended/)).toBeInTheDocument();
    expect(screen.getByText(/paused/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$29/month" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$290/year" })).toBeInTheDocument();
    // The quiet single-action copy from the running-trial state must not appear here.
    expect(screen.queryByRole("button", { name: "Add payment method" })).not.toBeInTheDocument();
  });

  it("ACTIVE: renders no price and no subscribe button - only a quiet Manage billing link", () => {
    render(<BillingBanner subscription={base({ status: "ACTIVE", isLapsed: false })} />);

    expect(screen.getByRole("button", { name: "Manage billing" })).toBeInTheDocument();
    expect(screen.queryByText(/\$29/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$290/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "$29/month" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "$290/year" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add payment method" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start free trial" })).not.toBeInTheDocument();
  });

  it("PAST_DUE, within grace: states the failure and days of grace remaining, one action - Update payment method", () => {
    render(<BillingBanner subscription={base({ status: "PAST_DUE", isLapsed: false, graceDaysRemaining: 4 })} />);

    expect(screen.getByText(/last payment failed/)).toBeInTheDocument();
    expect(screen.getByText(/4 days/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update payment method" })).toBeInTheDocument();
    expect(screen.queryByText("$29/month")).not.toBeInTheDocument();
    expect(screen.queryByText("$290/year")).not.toBeInTheDocument();
  });

  it("PAST_DUE, grace period ended: states the failure and that exports are blocked, still one action", () => {
    render(<BillingBanner subscription={base({ status: "PAST_DUE", isLapsed: true, graceDaysRemaining: -1 })} />);

    expect(screen.getByText(/grace period has ended/)).toBeInTheDocument();
    expect(screen.getByText(/paused/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update payment method" })).toBeInTheDocument();
  });

  it("CANCELED: states what they keep and what stopped, then both plan choices", () => {
    render(<BillingBanner subscription={base({ status: "CANCELED", isLapsed: true })} />);

    expect(screen.getByText(/existing exports and run history stay visible/)).toBeInTheDocument();
    expect(screen.getByText(/past files stay downloadable/)).toBeInTheDocument();
    expect(screen.getByText(/paused/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$29/month" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "$290/year" })).toBeInTheDocument();
  });

  it("disables the shown action while the checkout request is in flight, so a double click cannot start two sessions", async () => {
    const user = userEvent.setup();
    let resolveFetch: (() => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = () => resolve({ ok: true, json: async () => ({ url: "https://checkout.stripe.com/x" }) });
        }),
    ) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<BillingBanner subscription={base({ status: "CANCELED", isLapsed: true })} />);

    const monthlyButton = screen.getByRole("button", { name: "$29/month" });
    const yearlyButton = screen.getByRole("button", { name: "$290/year" });
    expect(monthlyButton).not.toBeDisabled();

    await user.click(monthlyButton);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Redirecting…" })).toBeDisabled();
    expect(yearlyButton).toBeDisabled(); // the OTHER action is disabled too, not just the clicked one

    await user.click(yearlyButton); // a second click while pending must not fire a second request
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch?.();
  });
});
