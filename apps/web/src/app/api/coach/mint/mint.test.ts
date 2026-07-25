import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => ({ userId: 1, wallet: "0x" + "22".repeat(20), privyDid: "did:x" })) }));
vi.mock("@/lib/coach/memory", async (orig) => ({
  ...(await orig()) as object,
  persistMemory: vi.fn(async () => ({ memory: { ok: true, rootHash: "0xm", txHash: "0xt1" }, profile: { ok: true, rootHash: "0xp", txHash: "0xt2" } })),
}));
vi.mock("@/lib/zerog/contracts", () => ({
  mintCoachOnChain: vi.fn(async () => ({ tokenId: "1", txHash: "0xmint" })),
  updateRegistry: vi.fn(async () => "0xreg"),
}));
const dbState: any = { coaches: [] };
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => dbState.coaches }) }),
    insert: () => ({ values: (v: any) => ({ returning: async () => { dbState.coaches.push(v); return [v]; } }) }),
  },
}));

describe("POST /api/coach/mint", () => {
  beforeEach(() => { dbState.coaches = []; });
  it("minta e ritorna explorer url", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://x/api/coach/mint", {
      method: "POST", headers: { authorization: "Bearer t" },
      body: JSON.stringify({ name: "Kilian", personality: "coach", userKeyHex: "aa".repeat(32) }),
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.explorerUrl).toContain("chainscan-galileo.0g.ai/tx/0xmint");
  });
  it("secondo mint → 409", async () => {
    const { POST } = await import("./route");
    const mk = () => new Request("http://x", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ name: "K", personality: "coach", userKeyHex: "aa".repeat(32) }) });
    await POST(mk());
    expect((await POST(mk())).status).toBe(409);
  });
  it("personalità invalida → 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://x", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ name: "K", personality: "hard", userKeyHex: "aa".repeat(32) }) }));
    expect(res.status).toBe(400);
  });
});
