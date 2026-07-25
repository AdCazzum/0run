// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const WALLET = "0x" + "22".repeat(20);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: true, user: { wallet: { address: WALLET } } }),
  getAccessToken: vi.fn(async () => "token"),
}));

// The IDKit widget itself needs a live World App to drive end-to-end (see the
// Task 5 report) — like the existing, untested app/events/[id]/claim-widget.tsx,
// it's stubbed out here so this test only exercises OUR copy/state logic, not
// World's SDK internals.
vi.mock("@worldcoin/idkit", () => ({
  IDKitRequestWidget: () => null,
  proofOfHuman: (opts: unknown) => opts,
}));

describe("CoachBadge — the honesty rule (Task 5)", () => {
  it("already claimed: reads 'coach · autodichiarato', never the word 'verified', and states the trust ladder", async () => {
    vi.stubEnv("NEXT_PUBLIC_WORLD_APP_ID", "app_test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ claimed: true, claimedAt: new Date().toISOString() }) })),
    );
    const { CoachBadge } = await import("./coach-badge");
    render(<CoachBadge />);
    await waitFor(() => screen.getByText(/coach · autodichiarato/i));

    // The whole point of the feature: never render "verified" as a claim about
    // coaching competence, and never omit the trust ladder.
    expect(document.body.textContent).not.toMatch(/verified coach|coach verificato/i);
    expect(document.body.textContent).toMatch(/umano unico verificato/i);
    expect(document.body.textContent).toMatch(/autodichiarazione/i);
    expect(document.body.textContent).toMatch(/reputazione guadagnata/i);
  });

  it("not yet claimed: offers the claim action and still states the trust ladder up front", async () => {
    vi.stubEnv("NEXT_PUBLIC_WORLD_APP_ID", "app_test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ claimed: false, claimedAt: null }) })),
    );
    const { CoachBadge } = await import("./coach-badge");
    render(<CoachBadge />);
    await waitFor(() => screen.getByRole("button", { name: /i'm a coach/i }));
    expect(document.body.textContent).not.toMatch(/verified coach|coach verificato/i);
    expect(document.body.textContent).toMatch(/umano unico verificato/i);
  });

  it("World ID not configured on this deployment: says so instead of pretending the claim works", async () => {
    vi.stubEnv("NEXT_PUBLIC_WORLD_APP_ID", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ claimed: false, claimedAt: null }) })),
    );
    const { CoachBadge } = await import("./coach-badge");
    render(<CoachBadge />);
    await waitFor(() => screen.getByText(/isn't configured on this deployment/i));
    expect(screen.queryByRole("button", { name: /i'm a coach/i })).toBeNull();
  });
});
