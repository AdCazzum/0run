import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.A2A_SIGNER_PRIVATE_KEY = "0x" + "01".padStart(64, "0"); // address 0x7E5F...5Bdf
process.env.AGENT_NFT_ADDRESS = "0x" + "0d".repeat(20);
process.env.SITE_URL = "https://0run.fun";

const state: { coach: any } = { coach: null };
vi.mock("@/db", async () => {
  const schema = await import("@/db/schema");
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: async () => (table === schema.coaches && state.coach ? [state.coach] : []),
        }),
      }),
    },
  };
});

const params = (tokenId: string) => ({ params: Promise.resolve({ tokenId }) });

describe("GET /api/coach/[tokenId]/agent.json", () => {
  beforeEach(() => {
    state.coach = {
      id: 2, userId: 2, tokenId: "2", name: "Pedro", personality: "drill-sergeant",
      memoryRoot: "0xm", profileRoot: "0xp", mintTx: "0xmint", ensName: "pedro.0run.eth",
    };
  });

  it("carta pubblica: identità ENS, capabilities, endpoint a2a, pointer iNFT, signer", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://x"), params("2"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      name: "Pedro",
      ensName: "pedro.0run.eth",
      personality: "drill-sergeant",
      capabilities: ["coach-consult"],
      endpoints: { web: "https://0run.fun/coach/2", a2a: "https://0run.fun/api/coach/2/a2a" },
      avatar: "https://0run.fun/api/coach/2/avatar",
      signer: "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf",
    });
    expect(body.inft).toBe(`16602:${process.env.AGENT_NFT_ADDRESS}:2`);
    // Mai dati privati sulla carta.
    expect(JSON.stringify(body)).not.toContain("0xm");
  });

  it("coach inesistente → 404; tokenId non numerico → 400", async () => {
    const { GET } = await import("./route");
    state.coach = null;
    expect((await GET(new Request("http://x"), params("9"))).status).toBe(404);
    expect((await GET(new Request("http://x"), params("abc"))).status).toBe(400);
  });

  it("dichiara la policy di ammissione human-backed (statica, senza RPC)", async () => {
    process.env.REQUIRE_HUMAN_BACKED_A2A = "1";
    const { GET } = await import("./route");
    const body = await (await GET(new Request("http://x"), params("2"))).json();
    expect(body.humanBacking).toEqual({
      enforced: true,
      registry: { contract: "0xA23aB2712eA7BBa896930544C7d6636a96b944dA", network: "eip155:480" },
    });
    delete process.env.REQUIRE_HUMAN_BACKED_A2A;
  });
});
