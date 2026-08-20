// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

import { LogoutButton } from "@/components/logout-button";

describe("LogoutButton", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    push.mockClear();
    refresh.mockClear();
  });

  it("renders with a click handler wired up and calls the logout endpoint when clicked", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => ({ ok: true })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    render(<LogoutButton />);

    const button = screen.getByRole("button", { name: "Sign out" });
    await user.click(button);

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
    expect(push).toHaveBeenCalledWith("/");
    expect(refresh).toHaveBeenCalled();
  });
});
