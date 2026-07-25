// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const pathname = vi.hoisted(() => ({ value: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

import { SiteHeader } from "./site-header";

afterEach(cleanup);

describe("SiteHeader", () => {
  it("offre una via di ritorno nell'app: nessuna pagina pubblica è un vicolo cieco", () => {
    pathname.value = "/coaches";
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: /your runs/i }).getAttribute("href")).toBe("/dashboard");
  });

  it("porta a tutte le sezioni pubbliche", () => {
    pathname.value = "/coaches";
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: /directory/i }).getAttribute("href")).toBe("/coaches");
    expect(screen.getByRole("link", { name: /^events$/i }).getAttribute("href")).toBe("/events");
    expect(screen.getByRole("link", { name: /technology/i }).getAttribute("href")).toBe("/technology");
  });

  it("segna la sezione corrente", () => {
    pathname.value = "/events";
    render(<SiteHeader />);
    expect(screen.getByRole("link", { name: /^events$/i }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: /directory/i }).getAttribute("aria-current")).toBeNull();
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
    expect(screen.getByRole("link", { name: /directory/i }).getAttribute("aria-current")).toBeNull();
  });

  it("non usa hook di Privy: una pagina pubblica non deve dipendere dall'auth configurata", () => {
    const source = readFileSync("src/components/landing/site-header.tsx", "utf8");
    expect(source).not.toMatch(/privy/i);
  });
});
