import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoachProfile } from "@0run/shared";

process.env.SERVICE_ENC_KEY = "aa".repeat(32);

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ userId: 2, wallet: "0x" + "22".repeat(20), privyDid: "did:asker" })),
}));

// --- db mock -----------------------------------------------------------
// Two different call shapes hit this mock: `db.select().from(coaches).where(...)`
// (owner coach lookup, awaited directly) and
// `db.select().from(runs).where(...).orderBy(...).limit(1)` (the asker's own
// latest run). One thenable/chainable builder serves both.
const state: { ownerCoach: any; askerLatestRun: any } = { ownerCoach: null, askerLatestRun: null };

function queryBuilder(rows: any[]) {
  let result = rows;
  const builder: any = {
    orderBy: () => builder,
    limit: (n: number) => {
      result = result.slice(0, n);
      return builder;
    },
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

vi.mock("@/db", async () => {
  const schema = await import("@/db/schema");
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === schema.coaches) return queryBuilder(state.ownerCoach ? [state.ownerCoach] : []);
            if (table === schema.runs) return queryBuilder(state.askerLatestRun ? [state.askerLatestRun] : []);
            return queryBuilder([]);
          },
        }),
      }),
      // If the route ever tries to write, this mock has no insert/update —
      // any such call throws, which the route's catch turns into a 500,
      // failing the "success" test below. That failure IS the assertion
      // that this route never writes to the owner's memory (or anywhere else).
    },
  };
});

// --- 0G Storage mock -----------------------------------------------------
const downloadDecryptedMock = vi.fn();
vi.mock("@/lib/zerog/storage", () => ({ downloadDecrypted: downloadDecryptedMock }));

// --- crypto mock -----------------------------------------------------------
const fakeProfile: CoachProfile = {
  version: 1,
  name: "Nova",
  personality: "coach",
  totals: { runs: 40, km: 210 },
  paceTrend: [305, 300, 298],
  styleNotes: "Balanced professional.",
};
const decryptJsonMock = vi.fn(() => fakeProfile);
vi.mock("@/lib/crypto/aes", async (orig) => ({
  ...((await orig()) as object),
  decryptJson: decryptJsonMock,
}));

// --- inference mock -----------------------------------------------------------
const coachCompleteMock = vi.fn(async (_messages: { role: string; content: string }[]) => ({
  text: "Your split held up well after km 8 — that's the pacer discipline paying off.",
  verified: null,
  model: "glm-5.2",
  path: "router" as const,
}));
vi.mock("@/lib/inference", () => ({ coachComplete: coachCompleteMock }));

function req(body: any = { message: "what do you make of my last run?" }) {
  return new Request("http://x/api/coach/1/ask", {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = (tokenId: string) => ({ params: Promise.resolve({ tokenId }) });

describe("POST /api/coach/[tokenId]/ask", () => {
  beforeEach(() => {
    state.ownerCoach = {
      id: 1,
      userId: 1,
      tokenId: "1",
      name: "Nova",
      personality: "coach",
      memoryRoot: "0xOWNER_PRIVATE_MEMORY_ROOT",
      profileRoot: "0xOWNER_PROFILE_ROOT",
      mintTx: "0xmint",
      memoryCipher: "OWNER_PRIVATE_CIPHERTEXT_NEVER_TOUCHED",
    };
    state.askerLatestRun = {
      id: 99,
      userId: 2,
      status: "done",
      stats: { distanceKm: 10, durationSec: 3000, avgPaceSecKm: 300, elevationGainM: 40, splitsSecKm: [300], avgHr: null, startedAt: "2026-07-24T07:00:00.000Z" },
      report: { headline: "Solid tempo", analysis: "a", comparison: "c", advice: ["x"] },
      createdAt: "2026-07-24T07:00:00.000Z",
    };
    downloadDecryptedMock.mockReset().mockResolvedValue({ ok: true, data: Buffer.from(JSON.stringify(fakeProfile)) });
    decryptJsonMock.mockClear();
    coachCompleteMock.mockClear();
  });

  it("usa SOLO il profileRoot del coach owner (mai il memoryRoot / la privateLayer) e risponde con reply + disclaimer", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(), params("1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.reply).toBe("Your split held up well after km 8 — that's the pacer discipline paying off.");
    expect(body.coach).toMatchObject({ name: "Nova", personality: "coach" });
    expect(body.disclaimer).toBeTruthy();

    // The private-layer assertion: downloadDecrypted must be called with the
    // owner's PROFILE root, and must NEVER be called with the owner's
    // (private, wallet-key-encrypted) memory root.
    expect(downloadDecryptedMock).toHaveBeenCalledWith(
      "0xOWNER_PROFILE_ROOT", expect.anything(), expect.anything(),
    );
    expect(downloadDecryptedMock).not.toHaveBeenCalledWith(
      "0xOWNER_PRIVATE_MEMORY_ROOT", expect.anything(), expect.anything(),
    );
    // decryptJson must never be handed the owner's cached private-layer
    // ciphertext either (the one shortcut the normal /api/coach/chat route
    // uses for the OWNER's own chat — this route must not reuse it for a
    // stranger).
    expect(decryptJsonMock).not.toHaveBeenCalledWith(
      "OWNER_PRIVATE_CIPHERTEXT_NEVER_TOUCHED", expect.anything(), expect.anything(),
    );
  });

  it("include la corsa dell'asker (non dati privati dell'owner) nei messaggi mandati al modello", async () => {
    const { POST } = await import("./route");
    await POST(req(), params("1"));
    const [sentMessages] = coachCompleteMock.mock.calls[0];
    const joined = JSON.stringify(sentMessages);
    expect(joined).toContain("Solid tempo"); // the ASKER's own latest run report
    expect(joined).not.toContain("OWNER_PRIVATE_CIPHERTEXT_NEVER_TOUCHED");
  });

  it("senza token di auth → 401, mai chiamato coachComplete", async () => {
    const auth = await import("@/lib/auth");
    (auth.requireUser as any).mockRejectedValueOnce(Object.assign(new Error("missing token"), { status: 401 }));
    const { POST } = await import("./route");
    const res = await POST(req(), params("1"));
    expect(res.status).toBe(401);
    expect(coachCompleteMock).not.toHaveBeenCalled();
  });

  it("coach (owner) inesistente per quel tokenId → 404", async () => {
    state.ownerCoach = null;
    const { POST } = await import("./route");
    const res = await POST(req(), params("999"));
    expect(res.status).toBe(404);
    expect(coachCompleteMock).not.toHaveBeenCalled();
  });

  it("l'asker non ha ancora nessuna corsa → 409, mai chiamato coachComplete", async () => {
    state.askerLatestRun = null;
    const { POST } = await import("./route");
    const res = await POST(req(), params("1"));
    expect(res.status).toBe(409);
    expect(coachCompleteMock).not.toHaveBeenCalled();
  });

  it("profilo illeggibile → risponde comunque, ma dichiara di essere in versione ridotta", async () => {
    // Il profilo aggregato (totali, andamento del passo) è cifrato su 0G
    // Storage; se non si riesce a leggerlo, nome e personalità restano pubblici
    // sulla riga del coach. Rispondere con quelli è degradato, non falso — e
    // viene detto, invece di far fallire l'intera consultazione.
    downloadDecryptedMock.mockResolvedValueOnce({ ok: false, error: "0G storage down" });
    const { POST } = await import("./route");
    const res = await POST(req(), params("1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profileSource).toBe("public-row");
    expect(coachCompleteMock).toHaveBeenCalled();
  });

  it("usa la cache del profilo quando c'è: nessun giro su 0G Storage", async () => {
    // Il caso che rompeva la feature: un coach appena mintato ha il blob su 0G
    // Storage ma non ancora scaricabile, quindi ogni consultazione falliva.
    state.ownerCoach = { ...state.ownerCoach, profileCipher: "PROFILE_ENVELOPE_FROM_CACHE" };
    const { POST } = await import("./route");
    const res = await POST(req(), params("1"));
    expect(res.status).toBe(200);
    expect((await res.json()).profileSource).toBe("cache");
    expect(downloadDecryptedMock).not.toHaveBeenCalled();
  });

  it("tokenId non numerico → 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(), params("not-a-number"));
    expect(res.status).toBe(400);
  });

  it("message vuoto → 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ message: "" }), params("1"));
    expect(res.status).toBe(400);
  });

  it("body non JSON → 400, non un 500 non gestito", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/coach/1/ask", { method: "POST", headers: { authorization: "Bearer t" }, body: "{not valid json" }),
      params("1"),
    );
    expect(res.status).toBe(400);
  });
});
