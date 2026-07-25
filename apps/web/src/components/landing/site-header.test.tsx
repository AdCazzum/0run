// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const pathname = vi.hoisted(() => ({ value: "/" }));
const auth = vi.hoisted(() => ({ ready: true, authenticated: false, privyReady: false }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: auth.ready, authenticated: auth.authenticated, logout: vi.fn() }),
}));
vi.mock("@/app/providers", () => ({ usePrivyReady: () => auth.privyReady }));

import { SiteHeader } from "./site-header";

afterEach(() => {
  cleanup();
  auth.ready = true;
  auth.authenticated = false;
  auth.privyReady = false;
});

describe("SiteHeader", () => {
  it("offre una via di ritorno nell'app: nessuna pagina pubblica è un vicolo cieco", () => {
    pathname.value = "/coaches";
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: /your runs/i }).getAttribute("href")).toBe("/dashboard");
  });

  it("porta a tutte le sezioni pubbliche", () => {
    pathname.value = "/coaches";
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: /^coaches$/i }).getAttribute("href")).toBe("/coaches");
    expect(screen.getByRole("link", { name: /^events$/i }).getAttribute("href")).toBe("/events");
    expect(screen.getByRole("link", { name: /technology/i }).getAttribute("href")).toBe("/technology");
  });

  it("segna la sezione corrente", () => {
    pathname.value = "/events";
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: /^events$/i }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /^coaches$/i }).getAttribute("aria-current")).toBeNull();
  });

  it("una sottopagina resta dentro la sua sezione, un percorso simile no", () => {
    pathname.value = "/events/12";
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: /^events$/i }).getAttribute("aria-current")).toBe("page");
    cleanup();

    // /coach/3 is one agent's own page, not the directory at /coaches: a prefix
    // that merely looks alike must not light up the section.
    pathname.value = "/coach/3";
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: /^coaches$/i }).getAttribute("aria-current")).toBeNull();
  });

  it("chi è loggato ritrova le stesse destinazioni dell'app, non un menu diverso", () => {
    auth.privyReady = true;
    auth.authenticated = true;
    pathname.value = "/coaches";
    render(<SiteHeader />);

    for (const [name, href] of [
      [/^runs$/i, "/dashboard"],
      [/^upload$/i, "/upload"],
      [/^coach$/i, "/coach"],
    ] as const) {
      expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(href);
    }
    expect(screen.getByRole("button", { name: /sign out/i })).toBeTruthy();
  });

  it("senza provider Privy montato la pagina pubblica resta navigabile (niente 500)", () => {
    auth.privyReady = false;
    pathname.value = "/coaches";
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: /your runs/i }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
  });

  it("provider montato ma utente non loggato → nessuna tab dell'app", () => {
    auth.privyReady = true;
    auth.authenticated = false;
    pathname.value = "/coaches";
    render(<SiteHeader />);
    expect(screen.queryByRole("link", { name: /^upload$/i })).toBeNull();
    expect(screen.getByRole("link", { name: /your runs/i })).toBeTruthy();
  });
});
