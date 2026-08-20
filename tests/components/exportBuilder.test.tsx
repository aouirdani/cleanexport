// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { ExportBuilder } from "@/components/exports/export-builder";

const CONTACT_PROPERTIES = [
  {
    name: "email",
    label: "Email",
    type: "string",
    fieldType: "text",
    isSystem: false,
    description: null,
    calculated: false,
    hidden: false,
  },
];

describe("ExportBuilder", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders a name input on step 1 and enables Next once name, object type, and a property are set", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ properties: CONTACT_PROPERTIES }),
      })) as unknown as typeof fetch,
    );

    render(<ExportBuilder />);

    const nameInput = screen.getByLabelText("Name this export");
    expect(nameInput).toBeInTheDocument();

    const nextButton = screen.getByRole("button", { name: "Next" });
    expect(nextButton).toBeDisabled();

    await user.type(nameInput, "Q3 deals for finance");
    expect(nextButton).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: "Contacts" }));
    expect(nextButton).toBeEnabled();

    await user.click(nextButton);

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Email/ })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("option", { name: /Email/ }));

    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });
});
