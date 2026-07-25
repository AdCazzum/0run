import { afterEach, describe, expect, it, vi } from "vitest";
import { eventsEnabled, humanCoachEnabled } from "./features";

// Restore only the two keys this file touches. Replacing process.env wholesale
// leaks across test files — vitest isolates module registries, not the worker
// process — and wiped variables other suites set at module load (SERVICE_ENC_KEY,
// among others), failing them for no reason of their own.
const KEYS = ["NEXT_PUBLIC_FEATURE_EVENTS", "NEXT_PUBLIC_FEATURE_HUMAN_COACH"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
});

describe("feature flags", () => {
  it("una feature nascosta è spenta per DEFAULT, non per configurazione", () => {
    // Il default conta: se una release dimenticasse la variabile, la sezione
    // nascosta non deve riapparire da sola.
    delete process.env.NEXT_PUBLIC_FEATURE_EVENTS;
    delete process.env.NEXT_PUBLIC_FEATURE_HUMAN_COACH;
    expect(eventsEnabled()).toBe(false);
    expect(humanCoachEnabled()).toBe(false);
  });

  it("si accende SOLO con \"1\": nessun valore ambiguo la riapre", () => {
    for (const value of ["0", "", "true", "yes", "off"]) {
      process.env.NEXT_PUBLIC_FEATURE_EVENTS = value;
      expect(eventsEnabled()).toBe(false);
    }
    process.env.NEXT_PUBLIC_FEATURE_EVENTS = "1";
    expect(eventsEnabled()).toBe(true);
  });

  it("i due interruttori sono indipendenti", () => {
    process.env.NEXT_PUBLIC_FEATURE_EVENTS = "1";
    delete process.env.NEXT_PUBLIC_FEATURE_HUMAN_COACH;
    expect(eventsEnabled()).toBe(true);
    expect(humanCoachEnabled()).toBe(false);
  });
});

describe("le API di una feature nascosta restano chiuse", () => {
  it("POST /api/events risponde 404 finché la feature è nascosta", async () => {
    // Non basta togliere il link: questo endpoint spende gas della tesoreria e
    // scrive on-chain, quindi deve rifiutare anche una chiamata diretta.
    delete process.env.NEXT_PUBLIC_FEATURE_EVENTS;
    vi.resetModules();
    vi.doMock("@/lib/auth", () => ({ requireUser: vi.fn(async () => ({ userId: 1, wallet: "0x1", privyDid: "d" })) }));
    vi.doMock("@/db", () => ({ db: {} }));
    const { POST } = await import("@/app/api/events/route");
    const res = await POST(
      new Request("http://x/api/events", { method: "POST", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(404);
  });

  it("POST /api/coach-claims risponde 404 finché il badge è nascosto", async () => {
    delete process.env.NEXT_PUBLIC_FEATURE_HUMAN_COACH;
    vi.resetModules();
    vi.doMock("@/lib/auth", () => ({ requireUser: vi.fn(async () => ({ userId: 1, wallet: "0x1", privyDid: "d" })) }));
    vi.doMock("@/db", () => ({ db: {} }));
    const { POST } = await import("@/app/api/coach-claims/route");
    const res = await POST(
      new Request("http://x/api/coach-claims", { method: "POST", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(404);
  });
});
