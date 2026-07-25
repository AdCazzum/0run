import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoachMemory } from "@0run/shared";

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ userId: 1, wallet: "0x" + "22".repeat(20), privyDid: "did:x" })),
}));

// --- db mock -------------------------------------------------------------
// One in-memory store per table, keyed by the real table objects from
// @/db/schema (identity-compared inside the mocked `from`/`insert`), so a
// single mock can serve every query the route issues (coaches, chatMessages,
// runs) without guessing which table is which from call order.
const state: { coach: any; history: any[]; run: any | null; inserted: any[] } = {
  coach: null, history: [], run: null, inserted: [],
};

vi.mock("@/db", async () => {
  const schema = await import("@/db/schema");
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: async () => {
            if (table === schema.coaches) return state.coach ? [state.coach] : [];
            if (table === schema.chatMessages) return state.history;
            if (table === schema.runs) return state.run ? [state.run] : [];
            return [];
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: async (v: any) => {
          if (table === schema.chatMessages) state.inserted.push(...(Array.isArray(v) ? v : [v]));
          return [];
        },
      }),
    },
  };
});

vi.mock("@/lib/zerog/storage", () => ({
  downloadDecrypted: vi.fn(async () => {
    throw new Error("downloadDecrypted must not be called when coaches.memoryCipher is cached");
  }),
}));

// v1 -> v2 migration (parseMemory) is exercised for real in coach.test.ts;
// this fixture stays v2-shaped since the route now goes through parseMemory
// (@/lib/coach/memory) rather than decryptJson(..., CoachMemorySchema) directly.
const decryptedMemory: CoachMemory = {
  version: 2,
  coach: { name: "K", personality: "coach" },
  privateLayer: { runs: [], healthSnapshot: null },
};
vi.mock("@/lib/crypto/aes", async (orig) => ({
  ...(await orig()) as object,
  decryptJson: vi.fn(() => decryptedMemory),
}));

// Declares the messages parameter so assertions can read mock.calls[0][0]:
// with a zero-arg mock the call tuple is typed empty and tsc rejects the access.
const coachCompleteMock = vi.fn(async (_messages: { role: string; content: string }[]) => ({
  text: "Great pace today.", verified: null, model: "glm-5.2", path: "router" as const,
}));
vi.mock("@/lib/inference", () => ({ coachComplete: coachCompleteMock }));

function req(body: any = { message: "how did it go?", userKeyHex: "aa".repeat(32) }) {
  return new Request("http://x/api/coach/chat", {
    method: "POST", headers: { authorization: "Bearer t", "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

describe("POST /api/coach/chat", () => {
  beforeEach(() => {
    state.coach = {
      id: 1, userId: 1, tokenId: "1", name: "K", personality: "coach",
      memoryRoot: "0xm", profileRoot: "0xp", mintTx: "0xmint",
      memoryCipher: "cached-cipher-envelope",
    };
    state.history = [];
    state.run = null;
    state.inserted = [];
    coachCompleteMock.mockClear();
  });

  it("risponde usando la memoria in cache (mai downloadDecrypted) e salva user+assistant in storico", async () => {
    const { POST } = await import("./route");
    const { downloadDecrypted } = await import("@/lib/zerog/storage");
    const { decryptJson } = await import("@/lib/crypto/aes");

    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.reply).toBe("Great pace today.");
    expect(downloadDecrypted).not.toHaveBeenCalled();
    expect(decryptJson).toHaveBeenCalledWith("cached-cipher-envelope", expect.anything(), expect.anything());

    expect(state.inserted).toHaveLength(2);
    expect(state.inserted[0]).toMatchObject({ userId: 1, role: "user", content: "how did it go?" });
    expect(state.inserted[1]).toMatchObject({ userId: 1, role: "assistant", content: "Great pace today." });
  });

  it("coach mancante → 409, mai chiamata a coachComplete", async () => {
    state.coach = null;
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(coachCompleteMock).not.toHaveBeenCalled();
  });

  it("memoryCipher assente → fallback su downloadDecrypted (percorso re-sync)", async () => {
    state.coach.memoryCipher = null;
    const storage = await import("@/lib/zerog/storage");
    (storage.downloadDecrypted as any).mockImplementationOnce(async (rootHash: string) => {
      expect(rootHash).toBe("0xm");
      return { ok: true, data: Buffer.from(JSON.stringify({})) };
    });
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(storage.downloadDecrypted).toHaveBeenCalledTimes(1);
  });

  it("con runId di proprietà dell'utente: la corsa viene pinnata nei messaggi mandati al modello", async () => {
    state.run = {
      id: 42, userId: 1, status: "done",
      stats: { distanceKm: 5, durationSec: 1500, avgPaceSecKm: 300, elevationGainM: 10, splitsSecKm: [300], avgHr: null, startedAt: "2026-07-20T07:00:00.000Z" },
      report: { headline: "Solid effort", analysis: "a", comparison: "c", advice: ["x"] },
      steps: {}, polyline: null, gpxRoot: "0xgpx", registryTx: "0xreg", verifiedTee: "true", model: "glm-5.2",
      createdAt: "2026-07-20T07:00:00.000Z",
    };
    const { POST } = await import("./route");
    const res = await POST(req({ message: "how did it go?", userKeyHex: "aa".repeat(32), runId: 42 }));
    expect(res.status).toBe(200);
    const [sentMessages] = coachCompleteMock.mock.calls[0];
    const joined = JSON.stringify(sentMessages);
    expect(joined).toContain("Solid effort");
  });

  it("runId non di proprietà dell'utente (o inesistente) → chat generale, nessun crash", async () => {
    state.run = null;
    const { POST } = await import("./route");
    const res = await POST(req({ message: "hi", userKeyHex: "aa".repeat(32), runId: 999 }));
    expect(res.status).toBe(200);
  });

  it("userKeyHex non esadecimale → 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ message: "hi", userKeyHex: "zz".repeat(32) }));
    expect(res.status).toBe(400);
  });

  it("message vuoto → 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ message: "", userKeyHex: "aa".repeat(32) }));
    expect(res.status).toBe(400);
  });

  it("body non JSON → 400, non un 500 non gestito", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://x/api/coach/chat", {
      method: "POST", headers: { authorization: "Bearer t" }, body: "{not valid json",
    }));
    expect(res.status).toBe(400);
  });

  it("senza token di auth → 401", async () => {
    const auth = await import("@/lib/auth");
    (auth.requireUser as any).mockRejectedValueOnce(Object.assign(new Error("missing token"), { status: 401 }));
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(401);
  });
});
