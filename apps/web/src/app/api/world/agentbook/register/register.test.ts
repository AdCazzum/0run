import { beforeEach, describe, expect, it, vi } from "vitest";

const WALLET = "0x" + "ab".repeat(20);
const requireUserMock = vi.fn(async () => ({ userId: 1, wallet: WALLET, privyDid: "did:privy:x" }));
vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const PROOF = Array.from({ length: 8 }, (_, i) => "0x" + String(i + 1).padStart(64, "0"));
const goodBody = { root: "0xr00t", nonce: "3", nullifierHash: "0xn", proof: PROOF };
const req = (body: unknown) =>
  new Request("http://x/api/world/agentbook/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/world/agentbook/register", () => {
  beforeEach(() => {
    requireUserMock.mockClear();
    fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ txHash: "0xtx" }), { status: 200 }));
    delete process.env.AGENTBOOK_RELAY_URL;
  });

  it("inoltra al relay agent = wallet di sessione (mai dal body) + contract, e restituisce txHash", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ ...goodBody, agent: "0x" + "66".repeat(20) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ txHash: "0xtx" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://x402-worldchain.vercel.app/register");
    const sent = JSON.parse(init.body);
    expect(sent.agent).toBe(WALLET); // il campo `agent` del body è IGNORATO
    expect(sent).toMatchObject({ root: "0xr00t", nonce: "3", nullifierHash: "0xn", proof: PROOF });
    expect(sent.contract).toBe("0xA23aB2712eA7BBa896930544C7d6636a96b944dA");
  });

  it("AGENTBOOK_RELAY_URL sovrascrive il relay di default", async () => {
    process.env.AGENTBOOK_RELAY_URL = "https://relay.example/";
    const { POST } = await import("./route");
    await POST(req(goodBody));
    expect(fetchMock.mock.calls[0][0]).toBe("https://relay.example/register");
  });

  it("proof non di 8 elementi → 400, relay mai chiamato", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ ...goodBody, proof: PROOF.slice(0, 7) }));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("relay 4xx → 502 con l'errore del relay nel body", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "invalid proof" }), { status: 400 }));
    const { POST } = await import("./route");
    const res = await POST(req(goodBody));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("invalid proof");
  });

  it("relay irraggiungibile → 502, mai un throw", async () => {
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    const { POST } = await import("./route");
    expect((await POST(req(goodBody))).status).toBe(502);
  });
});
