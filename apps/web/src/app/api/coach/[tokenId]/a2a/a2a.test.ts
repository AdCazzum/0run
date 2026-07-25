import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signConsult, type ConsultPayload } from "@/lib/a2a/protocol";

// Chiave di test deterministica: address 0x7E5F...5Bdf (vedi protocol.test.ts).
const PK = ("0x" + "01".padStart(64, "0")) as `0x${string}`;
const SIGNER = "0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf";

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
      // Niente insert/update: se la route provasse a scrivere, il mock
      // esplode e il test happy-path fallisce — QUESTA è l'asserzione
      // "stateless" (stessa convenzione di ask.test.ts).
    },
  };
});

const resolveMock = vi.fn(async (_name: string): Promise<{ address: string | null; records: Record<string, string> }> => ({
  address: "0x" + "aa".repeat(20),
  records: { "agent-signer": SIGNER },
}));
vi.mock("@/lib/ens/resolve", () => ({ resolveCoachEns: resolveMock }));

const loadProfileMock = vi.fn(async () => ({
  profile: { version: 1, name: "Pedro", personality: "drill-sergeant", totals: { runs: 12, km: 88 }, paceTrend: [310], styleNotes: "Tough love." },
  profileSource: "cache" as const,
}));
vi.mock("@/lib/coach/consult-profile", () => ({ loadConsultProfile: loadProfileMock }));

const coachCompleteMock = vi.fn(async (_messages: { role: string; content: string }[]) => ({
  text: "Alterna lunghi progressivi e recuperi veri.", verified: null, model: "glm-5.2", path: "router" as const,
}));
vi.mock("@/lib/inference", () => ({ coachComplete: coachCompleteMock }));

const NOW = 1_753_440_000;
async function signedBody(overrides: Partial<ConsultPayload> = {}) {
  const payload: ConsultPayload = {
    from: "marco.0run.eth", to: "pedro.0run.eth",
    question: "Come imposti i lunghi oltre i 30km?", context: "",
    ts: NOW, nonce: "n-1", ...overrides,
  };
  return signConsult(payload, PK);
}
function req(body: unknown) {
  return new Request("http://x/api/coach/2/a2a", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
const params = (tokenId: string) => ({ params: Promise.resolve({ tokenId }) });

describe("POST /api/coach/[tokenId]/a2a", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
    state.coach = {
      id: 2, userId: 2, tokenId: "2", name: "Pedro", personality: "drill-sergeant",
      memoryRoot: "0xPRIVATE", profileRoot: "0xPROFILE", mintTx: "0xmint",
      memoryCipher: "PRIVATE_CIPHER_NEVER_TOUCHED", profileCipher: "PROFILE_CIPHER",
      ensName: "pedro.0run.eth",
    };
    resolveMock.mockClear();
    loadProfileMock.mockClear();
    coachCompleteMock.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("consulto firmato valido → 200 con reply e identità ENS del coach", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(await signedBody()), params("2"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.reply).toBe("Alterna lunghi progressivi e recuperi veri.");
    expect(body.coach).toMatchObject({ name: "Pedro", ensName: "pedro.0run.eth" });
    // L'identità del chiamante è stata verificata risolvendo il SUO nome ENS.
    expect(resolveMock).toHaveBeenCalledWith("marco.0run.eth");
  });

  it("firma di una chiave diversa da agent-signer → 401, inference mai chiamata", async () => {
    resolveMock.mockResolvedValueOnce({ address: "0x" + "aa".repeat(20), records: { "agent-signer": "0x" + "42".repeat(20) } });
    const { POST } = await import("./route");
    const res = await POST(req(await signedBody()), params("2"));
    expect(res.status).toBe(401);
    expect(coachCompleteMock).not.toHaveBeenCalled();
  });

  it("il nome del chiamante non risolve / manca agent-signer → 401", async () => {
    resolveMock.mockResolvedValueOnce({ address: null, records: {} });
    const { POST } = await import("./route");
    const res = await POST(req(await signedBody()), params("2"));
    expect(res.status).toBe(401);
  });

  it("ts stantio → 401", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(await signedBody({ ts: NOW - 3600 })), params("2"));
    expect(res.status).toBe(401);
  });

  it("`to` di un altro coach (replay) → 401", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(await signedBody({ to: "kilian.0run.eth" })), params("2"));
    expect(res.status).toBe(401);
  });

  it("coach inesistente → 404; coach senza ensName → 409", async () => {
    const { POST } = await import("./route");
    state.coach = null;
    expect((await POST(req(await signedBody()), params("99"))).status).toBe(404);
    state.coach = { ...{ id: 2, userId: 2, tokenId: "2", name: "Pedro", personality: "drill-sergeant", memoryRoot: "0xPRIVATE", profileRoot: "0xPROFILE", mintTx: "0xmint", profileCipher: "PROFILE_CIPHER" }, ensName: null };
    expect((await POST(req(await signedBody()), params("2"))).status).toBe(409);
  });

  it("body non conforme → 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ hello: "world" }), params("2"));
    expect(res.status).toBe(400);
  });

  it("inference fallita → 502", async () => {
    coachCompleteMock.mockRejectedValueOnce(new Error("0G down"));
    const { POST } = await import("./route");
    const res = await POST(req(await signedBody()), params("2"));
    expect(res.status).toBe(502);
  });

  it("il prompt del consulente non offre consulti a sua volta (anti-loop) e porta la domanda", async () => {
    const { POST } = await import("./route");
    await POST(req(await signedBody()), params("2"));
    const [sentMessages] = coachCompleteMock.mock.calls[0];
    const joined = JSON.stringify(sentMessages);
    expect(joined).toContain("Come imposti i lunghi oltre i 30km?");
    expect(joined).not.toContain("<consult");
  });
});
