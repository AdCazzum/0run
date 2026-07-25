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

// Il Direct e' l'unico path che restituisce un'attestazione per-risposta (verified
// booleano da processResponse) ed e' pagato dalla tesoreria on-chain; il Router
// raggiunge modelli piu' grandi ma non attesta. L'ordine e' quindi configurabile e
// il path non preferito resta fallback automatico.
describe("preferenza del path di inferenza", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("./direct");
    delete process.env.DIRECT_ENABLED;
    delete process.env.INFERENCE_PREFER;
  });

  it("INFERENCE_PREFER=direct → prova il direct PRIMA, il router non viene chiamato", async () => {
    process.env.DIRECT_ENABLED = "1";
    process.env.INFERENCE_PREFER = "direct";
    const fetchMock = vi.fn(async () => ok("dal router"));
    vi.stubGlobal("fetch", fetchMock);
    const directMock = vi.fn(async () => ({ text: "dal direct", verified: true, model: "qwen2.5-omni-7b", path: "direct" as const }));
    vi.doMock("./direct", () => ({ directComplete: directMock }));
    vi.resetModules();
    const { coachComplete } = await import("./index");
    const r = await coachComplete([{ role: "user", content: "hi" }]);
    expect(r.text).toBe("dal direct");
    expect(r.verified).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("INFERENCE_PREFER=direct ma il direct fallisce → fallback sul router", async () => {
    process.env.DIRECT_ENABLED = "1";
    process.env.INFERENCE_PREFER = "direct";
    vi.stubGlobal("fetch", vi.fn(async () => ok("dal router")));
    vi.doMock("./direct", () => ({ directComplete: vi.fn(async () => { throw new Error("provider giù"); }) }));
    vi.resetModules();
    const { coachComplete } = await import("./index");
    const r = await coachComplete([{ role: "user", content: "hi" }]);
    expect(r.text).toBe("dal router");
    expect(r.path).toBe("router");
  });

  it("senza INFERENCE_PREFER → resta router-first (comportamento di default invariato)", async () => {
    process.env.DIRECT_ENABLED = "1";
    const directMock = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => ok("dal router")));
    vi.doMock("./direct", () => ({ directComplete: directMock }));
    vi.resetModules();
    const { coachComplete } = await import("./index");
    expect((await coachComplete([{ role: "user", content: "hi" }])).path).toBe("router");
    expect(directMock).not.toHaveBeenCalled();
  });
});
