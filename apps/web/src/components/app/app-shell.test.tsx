// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

const logout = vi.fn().mockResolvedValue(undefined);
const push = vi.fn();

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true, logout }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push }),
}));

import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("renders the three tabs twice (top nav + bottom bar) with the active marker on Runs", () => {
    render(<AppShell>content</AppShell>);
    for (const label of ["Runs", "Upload", "Coach"]) {
      // Anchored: the public "Coaches" link in the same bar would otherwise be
      // counted as a third "Coach" tab.
      expect(screen.getAllByRole("link", { name: new RegExp(`^${label}$`, "i") })).toHaveLength(2);
    }
    const active = screen.getAllByRole("link", { name: /^Runs$/i });
    for (const link of active) expect(link.getAttribute("aria-current")).toBe("page");
  });

  it("signs out via Privy then lands on the public page", async () => {
    render(<AppShell>content</AppShell>);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(logout).toHaveBeenCalled();
  });
});
