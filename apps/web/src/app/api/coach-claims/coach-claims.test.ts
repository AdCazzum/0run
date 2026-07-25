import { beforeEach, describe, expect, it, vi } from "vitest";

// Il badge coach umano sono nascosti in prod (lib/features.ts) ma la feature esiste
// e resta testata: questi test la accendono. Il gate stesso è verificato in
// src/lib/features.test.ts.
process.env.NEXT_PUBLIC_FEATURE_HUMAN_COACH = "1";


const WALLET = "0x" + "22".repeat(20);

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ userId: 1, wallet: WALLET, privyDid: "did:x" })),
}));

vi.mock("@/lib/world/verify", () => ({ verifyWorldProof: vi.fn() }));

// Same minimal-fake-operators approach as apps/web/src/app/api/events/events.test.ts:
// `eq` is turned into a plain inspectable object instead of a full SQL builder, and
// the @/db mock below compares column references against the REAL (unmocked) schema
// so it's exercising the actual column identities the route queries on.
vi.mock("drizzle-orm", async (orig) => {
  const real = await orig<typeof import("drizzle-orm")>();
  return {
    ...real,
    eq: (col: any, val: any) => ({ __op: "eq", col, val }),
  };
});

const state: { coachClaims: any[] } = { coachClaims: [] };

function colKey(table: any, col: any): string | undefined {
  return Object.keys(table).find((k) => table[k] === col);
}
function matches(table: any, row: any, cond: any): boolean {
  if (!cond) return true;
  if (cond.__op === "eq") {
    const key = colKey(table, cond.col);
    return key ? row[key] === cond.val : false;
  }
  return true;
}

vi.mock("@/db", async () => {
  const schema = await import("@/db/schema");
  const rowsOf = (table: any) => (table === schema.coachClaims ? state.coachClaims : []);
  return {
    db: {
      select: () => ({
        from: (table: any) => ({
          where: async (cond: any) => rowsOf(table).filter((r) => matches(table, r, cond)),
        }),
      }),
      insert: (table: any) => ({
        values: (v: any) => ({
          // No target: a real ON CONFLICT DO NOTHING with no target catches
          // ANY unique-constraint violation on the table — here that's
          // EITHER userId (one claim per account) OR nullifierHash
          // (anti-replay) — atomically, no separate check-then-write race.
          onConflictDoNothing: () => ({
            returning: async () => {
              if (table !== schema.coachClaims) return [];
              const conflict = state.coachClaims.some(
                (c) => c.userId === v.userId || c.nullifierHash === v.nullifierHash,
              );
              if (conflict) return [];
              // claimedAt is a column default in Postgres; the route reads it back.
              const row = { id: state.coachClaims.length + 1, claimedAt: new Date(), ...v };
              state.coachClaims.push(row);
              return [row];
            },
          }),
        }),
      }),
    },
  };
});

import { verifyWorldProof } from "@/lib/world/verify";
import { coachClaimSignal } from "@/lib/world/signal";

const IDKIT_RESULT = { protocol_version: "4.0", responses: [{ identifier: "orb", nullifier: "0xnul-1" }] };

function postReq(body: any) {
  return new Request("http://x/api/coach-claims", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify(body) });
}
function getReq() {
  return new Request("http://x/api/coach-claims", { headers: { authorization: "Bearer t" } });
}

describe("POST /api/coach-claims", () => {
  beforeEach(() => {
    state.coachClaims = [];
    vi.mocked(verifyWorldProof).mockReset();
  });

  it("proof invalida (World cloud-verify strict fallita) → 401, nessuna riga scritta", async () => {
    vi.mocked(verifyWorldProof).mockResolvedValueOnce({ ok: false, error: "proof non valida" });
    const { POST } = await import("./route");
    const res = await POST(postReq({ idkitResult: IDKIT_RESULT }));
    expect(res.status).toBe(401);
    expect(state.coachClaims).toHaveLength(0);
  });

  it("ricalcola il signal lato server come coach-claim:<wallet> (non si fida di un signal del client)", async () => {
    vi.mocked(verifyWorldProof).mockResolvedValueOnce({ ok: true, nullifierHash: "0xnul-1", level: "orb" });
    const { POST } = await import("./route");
    await POST(postReq({ idkitResult: IDKIT_RESULT, signal: "attacker-supplied-signal" }));
    expect(vi.mocked(verifyWorldProof)).toHaveBeenCalledWith(IDKIT_RESULT, coachClaimSignal(WALLET));
  });

  it("proof valida → 200 e riga coachClaims creata", async () => {
    vi.mocked(verifyWorldProof).mockResolvedValueOnce({ ok: true, nullifierHash: "0xnul-1", level: "orb" });
    const { POST } = await import("./route");
    const res = await POST(postReq({ idkitResult: IDKIT_RESULT }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(state.coachClaims).toHaveLength(1);
    expect(state.coachClaims[0]).toMatchObject({ userId: 1, nullifierHash: "0xnul-1" });
  });

  it("stesso nullifier riusato da un altro account → 409, nessuna riga duplicata", async () => {
    state.coachClaims = [{ id: 1, userId: 2, nullifierHash: "0xnul-1", claimedAt: new Date() }];
    vi.mocked(verifyWorldProof).mockResolvedValueOnce({ ok: true, nullifierHash: "0xnul-1", level: "orb" });
    const { POST } = await import("./route");
    const res = await POST(postReq({ idkitResult: IDKIT_RESULT }));
    expect(res.status).toBe(409);
    expect(state.coachClaims).toHaveLength(1);
  });

  it("lo stesso account che ha già un claim ne fa un secondo (nullifier diverso) → 409", async () => {
    state.coachClaims = [{ id: 1, userId: 1, nullifierHash: "0xold", claimedAt: new Date() }];
    vi.mocked(verifyWorldProof).mockResolvedValueOnce({ ok: true, nullifierHash: "0xnew", level: "orb" });
    const { POST } = await import("./route");
    const res = await POST(postReq({ idkitResult: IDKIT_RESULT }));
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toMatch(/already claimed|già/i);
    expect(state.coachClaims).toHaveLength(1);
  });
});

describe("GET /api/coach-claims", () => {
  it("nessun claim per questo account → claimed:false", async () => {
    state.coachClaims = [];
    const { GET } = await import("./route");
    const res = await GET(getReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.claimed).toBe(false);
  });

  it("claim esistente per questo account → claimed:true con claimedAt", async () => {
    const when = new Date();
    state.coachClaims = [{ id: 1, userId: 1, nullifierHash: "0xnul-1", claimedAt: when }];
    const { GET } = await import("./route");
    const res = await GET(getReq());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.claimed).toBe(true);
    expect(body.claimedAt).toBeTruthy();
  });
});
