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
vi.mock("@/app/providers", () => ({ usePrivyReady: () => true }));

import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("renders the shared site header — never a second one of its own", () => {
    render(<AppShell>content</AppShell>);
    // One banner for the whole site: this shell used to carry its own, so
    // crossing between app and public pages swapped the navigation out.
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    // And the public sections in that header are reachable from inside the app.
    expect(screen.getByRole("link", { name: /^coaches$/i }).getAttribute("href")).toBe("/coaches");
  });

  it("keeps the phone tab bar, with the active marker on Runs", () => {
    render(<AppShell>content</AppShell>);
    const bottomBar = screen.getByRole("navigation", { name: /^app$/i });
    for (const label of ["Runs", "Upload", "Coach"]) {
      expect(bottomBar.textContent).toContain(label);
    }
    const runs = [...bottomBar.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/dashboard")!;
    expect(runs.getAttribute("aria-current")).toBe("page");
  });

  it("signs out via Privy then lands on the public page", async () => {
    render(<AppShell>content</AppShell>);
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(logout).toHaveBeenCalled();
  });
});
