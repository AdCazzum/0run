import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const ok = (content: string) => ({
  ok: true, status: 200,
  json: async () => ({ choices: [{ message: { content } }], id: "chat-1" }),
  headers: new Headers(),
});

describe("inference", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("router: primo modello ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ok("ciao runner")));
    const { coachComplete } = await import("./index");
    const r = await coachComplete([{ role: "user", content: "hi" }]);
    expect(r.text).toBe("ciao runner");
    expect(r.path).toBe("router");
    expect(r.verified).toBeNull();
  });

  it("router: primario 503 → fallback model", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}), headers: new Headers() })
      .mockResolvedValueOnce(ok("dal fallback"));
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { coachComplete } = await import("./index");
    const r = await coachComplete([{ role: "user", content: "hi" }]);
    expect(r.text).toBe("dal fallback");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("completeJson: output sporco → retry con correzione → valida", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok("ecco il json: {\"headline\": 42}"))
      .mockResolvedValueOnce(ok('{"headline":"Gran tempo"}'));
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const { completeJson } = await import("./index");
    const { value } = await completeJson(z.object({ headline: z.string() }), [{ role: "user", content: "report" }]);
    expect(value.headline).toBe("Gran tempo");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("tutti i path falliscono → throw, MAI report inventato", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}), headers: new Headers() })));
    vi.resetModules();
    const { coachComplete } = await import("./index");
    await expect(coachComplete([{ role: "user", content: "hi" }])).rejects.toThrow();
  });

  it("router: errore di rete (fetch rejects) → dettaglio nel messaggio finale, non 'HTTP 0'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    vi.resetModules();
    const { coachComplete } = await import("./index");
    await expect(coachComplete([{ role: "user", content: "hi" }])).rejects.toThrow(/ECONNREFUSED/);
  });
});
