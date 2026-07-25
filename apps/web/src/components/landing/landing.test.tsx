// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
vi.mock("@privy-io/react-auth", () => ({ usePrivy: () => ({ authenticated: false }), useLogin: () => ({ login: vi.fn() }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { Hero } from "./hero";
import { HowItWorks } from "./how-it-works";
import { Manifesto } from "./manifesto";
import { BenefitsSection } from "./benefits-section";

describe("landing", () => {
  it("hero: headline serif con parola italic orange, overline con linea decorativa, CTA", () => {
    render(<Hero />);
    const em = screen.getByText("Coach.");
    expect(em.className).toContain("italic");
    expect(em.className).toContain("text-orange");
    expect(screen.getByTestId("hero-overline-line").className).toContain("h-px");
    expect(screen.getByRole("button", { name: /start running/i })).toBeTruthy();
  });
  it("how-it-works: heading fissa e 3 step numerati con serif italic", () => {
    render(<HowItWorks />);
    expect(screen.getByText(/three steps to a coach that is/i)).toBeTruthy();
    expect(screen.getByText("01")).toBeTruthy();
    expect(screen.getByText("02")).toBeTruthy();
    expect(screen.getByText("03")).toBeTruthy();
  });
  it("copy della home senza gergo tecnico (la tecnologia vive su /technology)", () => {
    const sections = [<Hero key="h" />, <Manifesto key="m" />, <HowItWorks key="w" />, <BenefitsSection key="b" />];
    const text = sections
      .map((s) => render(s).container.textContent)
      .join(" ")
      .toLowerCase();
    for (const banned of [/\bnft\b/, /\btee\b/, /\b0g\b/, /blockchain/, /on-chain/, /encrypt/, /\bgpx\b/, /wallet/]) {
      expect(text).not.toMatch(banned);
    }
  });
});
