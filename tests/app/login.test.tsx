// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// app/login/page.tsx - defect #4: "a failed OAuth redirects to
// /login?error=... which returns 404." This renders the actual async
// server component directly (awaiting it, then passing the resulting
// element to render()) rather than going through Next's router - the same
// approach as this repo's other component tests, just for a server
// component instead of a client one.
import LoginPage from "@/app/login/page";

describe("LoginPage", () => {
  afterEach(() => {
    cleanup();
  });

  it("always renders a working Connect HubSpot button, even with no error param", async () => {
    const element = await LoginPage({ searchParams: Promise.resolve({}) });
    render(element);

    const link = screen.getByRole("button", { name: "Connect HubSpot" });
    expect(link).toHaveAttribute("href", "/api/auth/hubspot/start");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["state_mismatch", /took too long/i],
    ["exchange_failed", /rejected the connection/i],
    ["denied", /cancelled/i],
    ["missing_code", /something went wrong/i],
  ])("says plainly what happened for error=%s", async (error, expectedText) => {
    const element = await LoginPage({ searchParams: Promise.resolve({ error }) });
    render(element);

    expect(screen.getByRole("alert")).toHaveTextContent(expectedText);
    // Always a working way to try again, regardless of which error.
    expect(screen.getByRole("button", { name: "Connect HubSpot" })).toHaveAttribute(
      "href",
      "/api/auth/hubspot/start",
    );
  });

  it("falls back to the generic message for an unrecognised error value, never a blank page", async () => {
    const element = await LoginPage({ searchParams: Promise.resolve({ error: "something_unexpected" }) });
    render(element);

    expect(screen.getByRole("alert")).toHaveTextContent(/something went wrong/i);
  });
});
