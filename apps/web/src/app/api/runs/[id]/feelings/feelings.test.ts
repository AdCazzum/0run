import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptJson } from "@/lib/crypto/aes";

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ userId: 1, wallet: "0x" + "22".repeat(20), privyDid: "did:x" })),
}));

// Simulates the ownership-scoped query in the route: state.run is what the
// (id AND userId) WHERE clause would have matched — null models both "no
// such run" and "run belongs to someone else", since the route can't (and
// shouldn't) distinguish the two.
const state: { run: any | null } = { run: null };
vi.mock("@/db", async () => {
  const schema = await import("@/db/schema");
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: async () => (table === schema.runs && state.run ? [state.run] : []),
        }),
      }),
    },
  };
});

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);

function req(body: any, id = "1") {
  return {
    request: new Request(`http://x/api/runs/${id}/feelings`, {
      method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(body),
    }),
    params: Promise.resolve({ id }),
  };
}

describe("POST /api/runs/:id/feelings", () => {
  beforeEach(() => {
    state.run = {
      id: 1, userId: 1, status: "done", steps: {}, stats: null, polyline: null, gpxRoot: null,
      registryTx: null, report: null, verifiedTee: null, model: null, effortScore: null, scoreNote: null,
      scoreVerified: null, createdAt: new Date(),
      feelingsCipher: encryptJson("legs felt heavy today", KEY),
    };
  });

  it("chiave corretta → testo in chiaro", async () => {
    const { POST } = await import("./route");
    const { request, params } = req({ userKeyHex: KEY.toString("hex") });
    const res = await POST(request, { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.feelings).toBe("legs felt heavy today");
  });

  it("chiave sbagliata → fallimento, senza far trapelare nulla", async () => {
    const { POST } = await import("./route");
    const { request, params } = req({ userKeyHex: OTHER_KEY.toString("hex") });
    const res = await POST(request, { params });
    const body = await res.json();
    expect(res.status).not.toBe(200);
    expect(body.feelings).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("legs felt heavy");
  });

  it("corsa inesistente o di un altro utente → 404", async () => {
    state.run = null;
    const { POST } = await import("./route");
    const { request, params } = req({ userKeyHex: KEY.toString("hex") });
    const res = await POST(request, { params });
    expect(res.status).toBe(404);
  });

  it("nessuna ciphertext salvata (feelings mai inviate) → 200 con feelings null, mai un placeholder", async () => {
    state.run.feelingsCipher = null;
    const { POST } = await import("./route");
    const { request, params } = req({ userKeyHex: KEY.toString("hex") });
    const res = await POST(request, { params });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.feelings).toBeNull();
  });

  it("userKeyHex non esadecimale → 400", async () => {
    const { POST } = await import("./route");
    const { request, params } = req({ userKeyHex: "zz".repeat(32) });
    const res = await POST(request, { params });
    expect(res.status).toBe(400);
  });

  it("body non JSON → 400, non un 500 non gestito", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/runs/1/feelings", { method: "POST", headers: { authorization: "Bearer t" }, body: "{not valid json" }),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(res.status).toBe(400);
  });

  it("senza token di auth → 401", async () => {
    const auth = await import("@/lib/auth");
    (auth.requireUser as any).mockRejectedValueOnce(Object.assign(new Error("missing token"), { status: 401 }));
    const { POST } = await import("./route");
    const { request, params } = req({ userKeyHex: KEY.toString("hex") });
    const res = await POST(request, { params });
    expect(res.status).toBe(401);
  });
});
