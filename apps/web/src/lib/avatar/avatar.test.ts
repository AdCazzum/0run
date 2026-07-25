import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _setFetchForTest, buildAvatarPrompt, generateAvatar } from "./generate";

const B64 = "aVZCT1J3MEtHZ28=";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  process.env.ROUTER_API_URL = "https://router.example/v1";
  process.env.ROUTER_API_KEY = "sk-test";
});
afterEach(() => _setFetchForTest(null));

describe("buildAvatarPrompt", () => {
  it("è deterministico: lo stesso coach si descrive sempre uguale", () => {
    expect(buildAvatarPrompt("Pedro", "drill_sergeant", "3")).toBe(
      buildAvatarPrompt("Pedro", "drill_sergeant", "3"),
    );
  });

  it("distingue due coach con la stessa personalità", () => {
    expect(buildAvatarPrompt("Pedro", "pacer", "3")).not.toBe(buildAvatarPrompt("Mario", "pacer", "4"));
  });

  it("porta la personalità e la palette nel prompt, e vieta il testo nell'immagine", () => {
    const prompt = buildAvatarPrompt("Pedro", "drill_sergeant", "3");
    expect(prompt).toMatch(/anime/i);
    expect(prompt).toMatch(/whip/i); // il coach cattivo ha la frusta
    expect(prompt).toMatch(/#FF6B35/);
    expect(prompt).toMatch(/no text/i);
  });

  it("ogni personalità resta vestita e non sessualizzata, qualunque sia il livello", () => {
    for (const p of ["pacer", "coach", "drill_sergeant"] as const) {
      const prompt = buildAvatarPrompt("Pedro", p, "3");
      expect(prompt).toMatch(/modest athletic sportswear/i);
      expect(prompt).toMatch(/non-sexualised/i);
      expect(prompt).toMatch(/adult/i);
    }
  });
});

describe("generateAvatar", () => {
  it("invia il job e poi ne raccoglie l'immagine", async () => {
    const calls: string[] = [];
    _setFetchForTest((async (url: any, init: any) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (String(url).includes("/async/images/generations")) {
        return jsonResponse({ jobId: "job-1", provider_address: "0xprov", status: "pending" });
      }
      return jsonResponse({
        status: "completed",
        data: { data: [{ b64_json: B64 }] },
        x_0g_trace: { tee_verified: true, billing: { total_cost: "42" } },
      });
    }) as any);

    const result = await generateAvatar("un prompt");

    expect(result).toEqual({
      ok: true,
      pngBase64: B64,
      model: "z-image-turbo",
      teeVerified: true,
      jobId: "job-1",
      costWei: "42",
    });
    // Il polling senza provider_address viene rifiutato dall'API: se sparisce
    // dall'URL, l'avatar non arriva mai e il test deve accorgersene.
    expect(calls[1]).toContain("provider_address=0xprov");
  });

  it("attende finché il job non è pronto", async () => {
    let polls = 0;
    _setFetchForTest((async (url: any) => {
      if (String(url).includes("/async/images/generations")) {
        return jsonResponse({ jobId: "job-1", provider_address: "0xprov" });
      }
      polls++;
      return polls < 3
        ? jsonResponse({ status: "running" })
        : jsonResponse({ status: "completed", data: { data: [{ b64_json: B64 }] } });
    }) as any);

    const result = await generateAvatar("un prompt");
    expect(result.ok).toBe(true);
    expect(polls).toBe(3);
  }, 20_000);

  it("un'attestazione assente NON diventa 'verificata'", async () => {
    _setFetchForTest((async (url: any) => {
      if (String(url).includes("/async/images/generations")) {
        return jsonResponse({ jobId: "job-1", provider_address: "0xprov" });
      }
      return jsonResponse({ status: "completed", data: { data: [{ b64_json: B64 }] } });
    }) as any);

    const result = await generateAvatar("un prompt");
    expect(result.ok && result.teeVerified).toBe(false);
  });

  it("job fallito → receipt di errore, mai un'eccezione", async () => {
    _setFetchForTest((async (url: any) => {
      if (String(url).includes("/async/images/generations")) {
        return jsonResponse({ jobId: "job-1", provider_address: "0xprov" });
      }
      return jsonResponse({ status: "failed", error: { message: "out of credit" } });
    }) as any);

    const result = await generateAvatar("un prompt");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("out of credit") });
  });

  it("HTTP 402 dal router → errore leggibile, nessun throw", async () => {
    _setFetchForTest((async () => new Response("Insufficient balance", { status: 402 })) as any);
    const result = await generateAvatar("un prompt");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/402/);
  });

  it("senza chiave configurata non chiama la rete", async () => {
    delete process.env.ROUTER_API_KEY;
    const spy = vi.fn();
    _setFetchForTest(spy as any);
    const result = await generateAvatar("un prompt");
    expect(result.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});
