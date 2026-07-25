import { beforeEach, describe, expect, it, vi } from "vitest";

// Gli eventi sono nascosti in prod (lib/features.ts) ma la feature esiste
// e resta testata: questi test la accendono. Il gate stesso è verificato in
// src/lib/features.test.ts.
process.env.NEXT_PUBLIC_FEATURE_EVENTS = "1";


const WALLET = "0x" + "22".repeat(20);

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ userId: 1, wallet: WALLET, privyDid: "did:x" })),
}));

vi.mock("@/lib/world/verify", () => ({ verifyWorldProof: vi.fn() }));

vi.mock("@/lib/world/runEvents", () => ({
  createEventOnChain: vi.fn(async () => ({ onchainId: "1", txHash: "0xcreate" })),
  signClaim: vi.fn(async () => "0xbackendsig"),
}));

// Minimal fake operators so the route's real `eq`/`and`/`count` calls
// (imported from the real drizzle-orm) produce plain, inspectable objects
// instead of full SQL builders — the @/db mock below interprets them by
// comparing column references against the REAL (unmocked) schema objects,
// so the filtering logic below is exercising the actual column identities
// the routes query on, not a hand-waved stand-in.
vi.mock("drizzle-orm", async (orig) => {
  const real = await orig<typeof import("drizzle-orm")>();
  return {
    ...real,
    eq: (col: any, val: any) => ({ __op: "eq", col, val }),
    and: (...conds: any[]) => ({ __op: "and", conds }),
    desc: (col: any) => ({ __op: "desc", col }),
    count: () => ({ __op: "count" }),
    isNull: (col: any) => ({ __op: "isNull", col }),
  };
});

const state: { events: any[]; claims: any[] } = { events: [], claims: [] };

function colKey(table: any, col: any): string | undefined {
  return Object.keys(table).find((k) => table[k] === col);
}
function matches(table: any, row: any, cond: any): boolean {
  if (!cond) return true;
  if (cond.__op === "and") return cond.conds.every((c: any) => matches(table, row, c));
  if (cond.__op === "isNull") {
    const key = colKey(table, cond.col);
    return key ? row[key] === null || row[key] === undefined : false;
  }
  if (cond.__op === "eq") {
    const key = colKey(table, cond.col);
    return key ? row[key] === cond.val : false;
  }
  return true;
}

vi.mock("@/db", async () => {
  const schema = await import("@/db/schema");
  const rowsOf = (table: any) => (table === schema.events ? state.events : table === schema.claims ? state.claims : []);
  return {
    db: {
      select: (proj?: any) => ({
        from: (table: any) => {
          const isCount = !!proj?.value && proj.value.__op === "count";
          return {
            orderBy: async () => [...rowsOf(table)],
            where: async (cond: any) => {
              const filtered = rowsOf(table).filter((r) => matches(table, r, cond));
              return isCount ? [{ value: filtered.length }] : filtered;
            },
          };
        },
      }),
      insert: (table: any) => ({
        values: (v: any) => {
          if (table === schema.events) {
            return {
              returning: async () => {
                const row = { id: state.events.length + 1, ...v };
                state.events.push(row);
                return [row];
              },
            };
          }
          if (table === schema.claims) {
            return {
              onConflictDoNothing: (_opts?: any) => ({
                returning: async () => {
                  const conflict = state.claims.some((c) => c.eventId === v.eventId && c.nullifierHash === v.nullifierHash);
                  if (conflict) return [];
                  // createdAt is a column default in Postgres; the reclaim path reads it.
                  const row = { id: state.claims.length + 1, createdAt: new Date(), ...v };
                  state.claims.push(row);
                  return [row];
                },
              }),
            };
          }
          return { returning: async () => [] };
        },
      }),
      delete: (table: any) => ({
        where: async (cond: any) => {
          const rows = rowsOf(table);
          const idx = rows.findIndex((r: any) => matches(table, r, cond));
          if (idx !== -1) rows.splice(idx, 1);
        },
      }),
      update: (table: any) => ({
        set: (patch: any) => ({
          where: (cond: any) => ({
            returning: async () => {
              const rows = rowsOf(table);
              const idx = rows.findIndex((r: any) => matches(table, r, cond));
              if (idx === -1) return [];
              rows[idx] = { ...rows[idx], ...patch };
              return [rows[idx]];
            },
          }),
        }),
      }),
    },
  };
});

import { verifyWorldProof } from "@/lib/world/verify";
import { createEventOnChain, signClaim } from "@/lib/world/runEvents";
import { claimSignal } from "@/lib/world/signal";

function eventsReq(body: any) {
  return new Request("http://x/api/events", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify(body) });
}
function claimReq(body: any) {
  return new Request("http://x/api/events/1/claim", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify(body) });
}
function patchReq(body: any) {
  return new Request("http://x/api/events/1/claim", { method: "PATCH", headers: { authorization: "Bearer t" }, body: JSON.stringify(body) });
}

const IDKIT_RESULT = { protocol_version: "4.0", responses: [{ identifier: "proof_of_human", nullifier: "0xnul-1" }] };

describe("POST /api/events", () => {
  beforeEach(() => {
    state.events = [];
    state.claims = [];
    vi.mocked(createEventOnChain).mockReset().mockResolvedValue({ onchainId: "1", txHash: "0xcreate" });
  });

  it("crea l'evento on-chain e la riga DB, risponde 200 con l'explorer url", async () => {
    const { POST } = await import("./route");
    const res = await POST(eventsReq({ name: "Morning Run", startsAt: 1000, endsAt: 5000 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.onchainId).toBe("1");
    expect(body.txHash).toBe("0xcreate");
    expect(body.explorerUrl).toContain("0xcreate");
    expect(state.events).toHaveLength(1);
    expect(state.events[0].creatorUserId).toBe(1);
  });

  it("finestra invalida (endsAt <= startsAt) → 400, nessuna chiamata on-chain", async () => {
    const { POST } = await import("./route");
    const res = await POST(eventsReq({ name: "X", startsAt: 5000, endsAt: 1000 }));
    expect(res.status).toBe(400);
    expect(vi.mocked(createEventOnChain)).not.toHaveBeenCalled();
  });

  it("il fallimento on-chain risponde 502 e non scrive la riga", async () => {
    vi.mocked(createEventOnChain).mockRejectedValueOnce(new Error("rpc down"));
    const { POST } = await import("./route");
    const res = await POST(eventsReq({ name: "X", startsAt: 1000, endsAt: 5000 }));
    expect(res.status).toBe(502);
    expect(state.events).toHaveLength(0);
  });
});

describe("GET /api/events", () => {
  beforeEach(() => {
    state.events = [
      { id: 1, onchainId: "1", creatorUserId: 1, name: "A", startsAt: new Date(0), endsAt: new Date(1), uri: null, txHash: "0xa" },
      { id: 2, onchainId: "2", creatorUserId: 1, name: "B", startsAt: new Date(0), endsAt: new Date(1), uri: null, txHash: "0xb" },
    ];
    state.claims = [
      { id: 1, eventId: 1, userId: 1, nullifierHash: "0xn1", txHash: "0xtx1" },
      { id: 2, eventId: 1, userId: 2, nullifierHash: "0xn2", txHash: null },
    ];
  });

  it("elenca gli eventi con il conteggio dei claim per evento", async () => {
    const { GET } = await import("./route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(body.events.map((e: any) => [e.id, e.claimCount]));
    expect(byId[1]).toBe(2);
    expect(byId[2]).toBe(0);
  });
});

describe("POST /api/events/:id/claim", () => {
  beforeEach(() => {
    state.events = [{ id: 1, onchainId: "1", creatorUserId: 1, name: "A", startsAt: new Date(Date.now() - 60_000), endsAt: new Date(Date.now() + 3_600_000), uri: null, txHash: "0xcreate" }];
    state.claims = [];
    vi.mocked(verifyWorldProof).mockReset();
    vi.mocked(signClaim).mockReset().mockResolvedValue("0xbackendsig");
  });

  it("proof valida → co-firma prodotta e riga claims inserita (nessuna tx on-chain qui: la invia il wallet del claimant)", async () => {
    vi.mocked(verifyWorldProof).mockResolvedValueOnce({ ok: true, nullifierHash: "0xnul-1", level: "proof_of_human" });
    const { POST } = await import("./[id]/claim/route");
    const res = await POST(claimReq({ idkitResult: IDKIT_RESULT }), { params: Promise.resolve({ id: "1" }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.backendSig).toBe("0xbackendsig");
    expect(body.onchainEventId).toBe("1");
    expect(state.claims).toHaveLength(1);
    expect(state.claims[0]).toMatchObject({ eventId: 1, userId: 1, nullifierHash: "0xnul-1", txHash: null });
  });

  it("ricalcola il signal lato server da eventId+wallet (non si fida di un signal del client)", async () => {
    vi.mocked(verifyWorldProof).mockResolvedValueOnce({ ok: true, nullifierHash: "0xnul-1", level: "proof_of_human" });
    const { POST } = await import("./[id]/claim/route");
    await POST(claimReq({ idkitResult: IDKIT_RESULT, signal: "attacker-supplied-signal" }), { params: Promise.resolve({ id: "1" }) });
    expect(vi.mocked(verifyWorldProof)).toHaveBeenCalledWith(IDKIT_RESULT, claimSignal("1", WALLET));
  });

  it("proof invalida (World cloud-verify strict fallita) → 401, nessuna firma prodotta, nessuna riga claims", async () => {
    vi.mocked(verifyWorldProof).mockResolvedValueOnce({ ok: false, error: "proof non valida" });
    const { POST } = await import("./[id]/claim/route");
    const res = await POST(claimReq({ idkitResult: IDKIT_RESULT }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(401);
    expect(vi.mocked(signClaim)).not.toHaveBeenCalled();
    expect(state.claims).toHaveLength(0);
  });

  // Una riga di claim resta "prenotata" (txHash null) tra la verifica World ID e la
  // conferma della tx dal wallet del claimant. Se l'utente abbandona il prompt, senza
  // recupero resterebbe fuori dall'evento per sempre — stesso lockout gia' chiuso sul mint.
  it("propria reservation non confermata e SCADUTA → reclamata, la co-firma viene riemessa", async () => {
    const stale = new Date(Date.now() - 11 * 60_000); // oltre i 10 minuti
    state.claims = [{ id: 1, eventId: 1, userId: 1, nullifierHash: "0xnul-1", txHash: null, createdAt: stale }];
    vi.mocked(verifyWorldProof).mockResolvedValueOnce({ ok: true, nullifierHash: "0xnul-1", level: "proof_of_human" });
    const { POST } = await import("./[id]/claim/route");
    const res = await POST(claimReq({ idkitResult: IDKIT_RESULT }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
    expect(vi.mocked(signClaim)).toHaveBeenCalledTimes(1);
    expect(state.claims).toHaveLength(1); // riga sostituita, non duplicata
  });

  it("propria reservation non confermata e FRESCA → 409 che dichiara il claim in corso", async () => {
    state.claims = [{ id: 1, eventId: 1, userId: 1, nullifierHash: "0xnul-1", txHash: null, createdAt: new Date() }];
    vi.mocked(verifyWorldProof).mockResolvedValueOnce({ ok: true, nullifierHash: "0xnul-1", level: "proof_of_human" });
    const { POST } = await import("./[id]/claim/route");
    const res = await POST(claimReq({ idkitResult: IDKIT_RESULT }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/in corso/i);
    expect(vi.mocked(signClaim)).not.toHaveBeenCalled();
  });

  it("reservation scaduta di un ALTRO utente → NON reclamata (sarebbe la via sybil che il nullifier chiude)", async () => {
    const stale = new Date(Date.now() - 60 * 60_000);
    state.claims = [{ id: 1, eventId: 1, userId: 99, nullifierHash: "0xnul-1", txHash: null, createdAt: stale }];
    vi.mocked(verifyWorldProof).mockResolvedValueOnce({ ok: true, nullifierHash: "0xnul-1", level: "proof_of_human" });
    const { POST } = await import("./[id]/claim/route");
    const res = await POST(claimReq({ idkitResult: IDKIT_RESULT }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(409);
    expect(vi.mocked(signClaim)).not.toHaveBeenCalled();
    expect(state.claims[0].userId).toBe(99); // intatta
  });

  it("nullifier già usato per lo stesso evento → 409 dal vincolo UNIQUE, nessuna firma", async () => {
    state.claims = [{ id: 1, eventId: 1, userId: 2, nullifierHash: "0xnul-1", txHash: "0xalready", createdAt: new Date() }];
    vi.mocked(verifyWorldProof).mockResolvedValueOnce({ ok: true, nullifierHash: "0xnul-1", level: "proof_of_human" });
    const { POST } = await import("./[id]/claim/route");
    const res = await POST(claimReq({ idkitResult: IDKIT_RESULT }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(409);
    expect(vi.mocked(signClaim)).not.toHaveBeenCalled();
    expect(state.claims).toHaveLength(1); // no duplicate row
  });

  it("evento inesistente → 404", async () => {
    const { POST } = await import("./[id]/claim/route");
    const res = await POST(claimReq({ idkitResult: IDKIT_RESULT }), { params: Promise.resolve({ id: "999" }) });
    expect(res.status).toBe(404);
    expect(vi.mocked(verifyWorldProof)).not.toHaveBeenCalled();
  });

  it("fuori dalla finestra di claim → 400, la proof non viene nemmeno verificata", async () => {
    state.events[0].endsAt = new Date(Date.now() - 1000);
    const { POST } = await import("./[id]/claim/route");
    const res = await POST(claimReq({ idkitResult: IDKIT_RESULT }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(400);
    expect(vi.mocked(verifyWorldProof)).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/events/:id/claim", () => {
  beforeEach(() => {
    state.events = [{ id: 1, onchainId: "1", creatorUserId: 1, name: "A", startsAt: new Date(0), endsAt: new Date(Date.now() + 3_600_000), uri: null, txHash: "0xcreate" }];
    state.claims = [{ id: 1, eventId: 1, userId: 1, nullifierHash: "0xnul-1", txHash: null, createdAt: new Date() }];
  });

  it("registra il tx hash dopo che il claimant ha inviato la tx dal proprio wallet", async () => {
    const { PATCH } = await import("./[id]/claim/route");
    const res = await PATCH(patchReq({ nullifierHash: "0xnul-1", txHash: "0xclaimtx" }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(200);
    expect(state.claims[0].txHash).toBe("0xclaimtx");
  });

  it("nessuna riga riservata corrispondente → 404", async () => {
    const { PATCH } = await import("./[id]/claim/route");
    const res = await PATCH(patchReq({ nullifierHash: "0xother", txHash: "0xclaimtx" }), { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(404);
  });
});
