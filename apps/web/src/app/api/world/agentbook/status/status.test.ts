import { beforeEach, describe, expect, it, vi } from "vitest";
import { _setAgentBookForTest } from "@/lib/world/agentbook";

const WALLET = "0x" + "ab".repeat(20);
const requireUserMock = vi.fn(async () => ({ userId: 1, wallet: WALLET, privyDid: "did:privy:x" }));
vi.mock("@/lib/auth", () => ({ requireUser: requireUserMock }));

const req = () => new Request("http://x/api/world/agentbook/status");

describe("GET /api/world/agentbook/status", () => {
  beforeEach(() => requireUserMock.mockClear());

  it("wallet registrato → registered:true con humanId, nessun nonce", async () => {
    _setAgentBookForTest({ lookupHuman: async () => "0x1234", getNextNonce: async () => "9" });
    const { GET } = await import("./route");
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ registered: true, humanId: "0x1234" });
  });

  it("wallet non registrato → registered:false con nonce fresco e wallet", async () => {
    _setAgentBookForTest({ lookupHuman: async () => null, getNextNonce: async () => "3" });
    const { GET } = await import("./route");
    const body = await (await GET(req())).json();
    expect(body).toEqual({ registered: false, humanId: null, nonce: "3", wallet: WALLET });
  });

  it("lookup non disponibile → 503, mai spacciato per non-registrato", async () => {
    _setAgentBookForTest({
      lookupHuman: async () => {
        throw new Error("rpc down");
      },
      getNextNonce: async () => "3",
    });
    const { GET } = await import("./route");
    const res = await GET(req());
    expect(res.status).toBe(503);
  });

  it("senza sessione → status dell'errore di requireUser", async () => {
    requireUserMock.mockRejectedValueOnce(Object.assign(new Error("missing token"), { status: 401 }));
    const { GET } = await import("./route");
    expect((await GET(req())).status).toBe(401);
  });
});
