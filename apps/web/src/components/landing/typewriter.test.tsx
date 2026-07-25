// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Typewriter } from "./typewriter";

const WORDS = ["Coach", "Data", "Training", "Health"];

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  })) as any;
}

/**
 * Advances exactly one animation step.
 *
 * React flushes a state update in a microtask, and the NEXT timeout is only
 * scheduled by the effect that runs after that flush — so one
 * advanceTimersByTime call can only ever fire one step of the chain, however
 * long the window. These tests therefore assert the SEQUENCE of frames, not
 * wall-clock timing.
 */
async function step(times = 1) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  mockReducedMotion(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const animatedText = (c: HTMLElement) => c.querySelector("[aria-hidden]")!.textContent;

describe("Typewriter", () => {
  it("parte dalla prima parola già completa: nessun titolo vuoto al primo frame", () => {
    const { container } = render(<Typewriter words={WORDS} />);
    expect(animatedText(container)).toBe("Coach.");
  });

  it("cancella lettera per lettera, poi digita la parola successiva", async () => {
    const { container } = render(<Typewriter words={WORDS} />);

    await step(); // fine della pausa: inizia a cancellare
    const erased: (string | null)[] = [];
    for (let i = 0; i < 5; i++) {
      await step();
      erased.push(animatedText(container));
    }
    expect(erased).toEqual(["Coac", "Coa", "Co", "C", ""]);

    await step(); // passa alla parola successiva
    const typed: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      await step();
      typed.push(animatedText(container));
    }
    expect(typed).toEqual(["D", "Da", "Dat", "Data."]);
  });

  it("il punto compare solo a parola finita", async () => {
    const { container } = render(<Typewriter words={WORDS} />);
    await step(2);
    expect(animatedText(container)).toBe("Coac"); // niente punto a metà
  });

  it("gira su tutte le parole e torna alla prima", async () => {
    const { container } = render(<Typewriter words={["Ab", "Cd"]} />);
    const seen = new Set<string>();
    // 2 words × (hold + 2 deletions + word switch + 2 keystrokes) with room to spare
    for (let i = 0; i < 30; i++) {
      await step();
      const text = animatedText(container);
      if (text?.endsWith(".")) seen.add(text);
    }
    expect([...seen].sort()).toEqual(["Ab.", "Cd."]);
  });

  it("con prefers-reduced-motion resta ferma sulla prima parola", async () => {
    mockReducedMotion(true);
    const { container } = render(<Typewriter words={WORDS} />);
    await step(20);
    expect(animatedText(container)).toBe("Coach.");
  });

  it("una sola parola non anima nulla", async () => {
    const { container } = render(<Typewriter words={["Coach"]} />);
    await step(20);
    expect(animatedText(container)).toBe("Coach.");
  });

  it("gli screen reader leggono una frase ferma, non i tasti battuti", async () => {
    const { container } = render(<Typewriter words={WORDS} />);
    await step(8); // ora la copia animata sta scrivendo un'altra parola
    expect(container.querySelector(".sr-only")!.textContent).toBe("Coach.");
    expect(animatedText(container)).not.toBe("Coach.");
  });
});
