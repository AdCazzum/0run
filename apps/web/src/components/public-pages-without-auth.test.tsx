// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * A build without NEXT_PUBLIC_PRIVY_APP_ID skips the Privy provider (see
 * app/providers.tsx), and every Privy hook then throws at render time. That is
 * what once turned the public landing page into a 500 — the worst possible place
 * for it — so every interactive widget on a PUBLIC page must survive it.
 *
 * The mock below reproduces the real failure: the hooks throw exactly as they do
 * with no provider mounted. A component that reaches one of them without going
 * through usePrivyReady() first fails this test.
 */
vi.mock("@privy-io/react-auth", () => {
  // Defined inside the factory: vi.mock is hoisted above module scope, so a
  // top-level helper would not exist yet when this runs.
  const providerMissing = () => {
    throw new Error("Cannot read properties of undefined — no PrivyProvider mounted");
  };
  return {
    usePrivy: providerMissing,
    useLogin: providerMissing,
    useSignMessage: providerMissing,
    useSendTransaction: providerMissing,
    getAccessToken: providerMissing,
  };
});
vi.mock("@/app/providers", () => ({ usePrivyReady: () => false }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/" }));
// IDKit reaches for browser APIs jsdom does not have; irrelevant to this test.
vi.mock("@worldcoin/idkit", () => ({ IDKitRequestWidget: () => null, proofOfHuman: {} }));

import { Hero } from "@/components/landing/hero";
import { SiteHeader } from "@/components/landing/site-header";
import { AskThisCoach } from "@/components/coach/ask-this-coach";
import { CreateEventForm } from "@/app/events/create-event-form";
import { ClaimWidget } from "@/app/events/[id]/claim-widget";

afterEach(cleanup);

describe("public pages with no auth provider", () => {
  it("the hero still offers the way in", () => {
    render(<Hero />);
    expect(screen.getByRole("link", { name: /start running/i })).toBeTruthy();
  });

  it("the header still navigates", () => {
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: /^coaches$/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /your runs/i })).toBeTruthy();
  });

  it("asking a coach says what it needs instead of crashing the page", () => {
    render(<AskThisCoach tokenId="3" coachLabel="Pedro" />);
    expect(screen.getByText(/needs an account/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /start here/i }).getAttribute("href")).toBe("/dashboard");
  });

  it("creating an event offers the destination, never a dead button", () => {
    render(<CreateEventForm />);
    expect(screen.getByRole("link", { name: /new event/i }).getAttribute("href")).toBe("/dashboard");
  });

  it("claiming an event explains it needs a wallet", () => {
    render(<ClaimWidget dbEventId={1} onchainEventId="1" />);
    expect(screen.getByText(/wallet to sign with/i)).toBeTruthy();
  });
});
