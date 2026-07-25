// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CoachMarkdown } from "./coach-markdown";

describe("CoachMarkdown", () => {
  it("rende gli elementi markdown che i modelli emettono davvero", () => {
    const { container } = render(
      <CoachMarkdown>{"# Recupero\n\nOggi **facile**.\n\n- primo\n- secondo"}</CoachMarkdown>,
    );
    // Le heading del modello scendono di livello: la pagina ha già il suo h1.
    expect(screen.getByText("Recupero").tagName).toBe("H3");
    expect(screen.getByText("facile").tagName).toBe("STRONG");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    // Tipografia del design system, non default del browser.
    expect(screen.getByText("Recupero").className).toContain("font-serif");
  });

  it("NON rende HTML grezzo: l'output del modello è untrusted", () => {
    const { container } = render(
      <CoachMarkdown>{'Attento <img src=x onerror="alert(1)"> e <script>alert(2)</script>'}</CoachMarkdown>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    // Il markup arriva a schermo come testo, non come elementi.
    expect(container.textContent).toContain("<img");
  });

  it("scarta gli href non http(s)", () => {
    const { container } = render(
      <CoachMarkdown>{"[clicca](javascript:alert(1)) e [vero](https://0run.fun)"}</CoachMarkdown>,
    );
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).not.toContain("javascript:alert(1)");
    expect(hrefs).toContain("https://0run.fun");
  });
});
