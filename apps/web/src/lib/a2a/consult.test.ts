import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.A2A_SIGNER_PRIVATE_KEY = "0x" + "01".padStart(64, "0");

// vi.mock factories are hoisted above top-level const declarations, and this
// test file (unlike a2a.test.ts) imports "./consult" statically below — which
// transitively pulls in "@/lib/ens/resolve" during module evaluation, before
// a plain `const resolveMock` would be assigned. Same fix as coaches.test.ts:
// create the mock fn through vi.hoisted() so it exists before the factory runs.
const { resolveMock } = vi.hoisted(() => ({ resolveMock: vi.fn() }));
vi.mock("@/lib/ens/resolve", () => ({ resolveCoachEns: resolveMock }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import { consultCoach, overrideOrigin } from "./consult";

describe("overrideOrigin", () => {
  it("senza override restituisce l'URL com'è", () => {
    expect(overrideOrigin("https://0run.fun/api/coach/2/a2a")).toBe("https://0run.fun/api/coach/2/a2a");
  });
  it("con override sostituisce solo l'origin, mai il path", () => {
    expect(overrideOrigin("https://0run.fun/api/coach/2/a2a", "http://localhost:3000")).toBe("http://localhost:3000/api/coach/2/a2a");
  });
});

describe("consultCoach", () => {
  beforeEach(() => {
    resolveMock.mockReset().mockResolvedValue({
      address: "0x" + "aa".repeat(20),
      records: { "agent-endpoint[a2a]": "https://0run.fun/api/coach/2/a2a" },
    });
    fetchMock.mockReset().mockResolvedValue(
      new Response(JSON.stringify({ reply: "Progressivi.", coach: { name: "Pedro", ensName: "pedro.0run.eth", personality: "drill-sergeant" } }), { status: 200 }),
    );
    delete process.env.A2A_ENDPOINT_OVERRIDE;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("risolve il target via ENS, firma e POSTa il payload completo", async () => {
    const res = await consultCoach("marco.0run.eth", "pedro.0run.eth", "Lunghi oltre 30km?", "ctx");
    expect(res).toMatchObject({ ok: true, reply: "Progressivi.", coach: { ensName: "pedro.0run.eth" } });
    expect(resolveMock).toHaveBeenCalledWith("pedro.0run.eth");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://0run.fun/api/coach/2/a2a");
    const sent = JSON.parse(init.body);
    expect(sent).toMatchObject({ from: "marco.0run.eth", to: "pedro.0run.eth", question: "Lunghi oltre 30km?", context: "ctx" });
    expect(sent.sig).toMatch(/^0x/);
    expect(typeof sent.ts).toBe("number");
    expect(sent.nonce).toBeTruthy();
  });

  it("A2A_ENDPOINT_OVERRIDE rimpiazza l'origin (dev locale)", async () => {
    vi.stubEnv("A2A_ENDPOINT_OVERRIDE", "http://localhost:3000");
    await consultCoach("marco.0run.eth", "pedro.0run.eth", "q", "");
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:3000/api/coach/2/a2a");
  });

  it("nome senza record agent-endpoint[a2a] → ok:false, nessuna fetch", async () => {
    resolveMock.mockResolvedValueOnce({ address: null, records: {} });
    const res = await consultCoach("marco.0run.eth", "sconosciuto.0run.eth", "q", "");
    expect(res).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("HTTP 401 dal ricevente → ok:false con l'errore del body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "firma non valida" }), { status: 401 }));
    const res = await consultCoach("marco.0run.eth", "pedro.0run.eth", "q", "");
    expect(res).toEqual({ ok: false, error: "firma non valida" });
  });

  it("fetch che lancia (timeout/rete) → ok:false, mai un throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    await expect(consultCoach("marco.0run.eth", "pedro.0run.eth", "q", "")).resolves.toMatchObject({ ok: false });
  });

  it("A2A_SIGNER_PRIVATE_KEY assente → ok:false, nessuna fetch", async () => {
    vi.stubEnv("A2A_SIGNER_PRIVATE_KEY", "");
    const res = await consultCoach("marco.0run.eth", "pedro.0run.eth", "q", "");
    expect(res).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("200 con body vuoto → ok:false, malformato", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    const res = await consultCoach("marco.0run.eth", "pedro.0run.eth", "q", "");
    expect(res).toMatchObject({ ok: false });
  });

  it("200 con reply ma senza coach → ok:false, malformato", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ reply: "Progressivi." }), { status: 200 }));
    const res = await consultCoach("marco.0run.eth", "pedro.0run.eth", "q", "");
    expect(res).toMatchObject({ ok: false });
  });
});
