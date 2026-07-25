import { beforeEach, describe, expect, it, vi } from "vitest";

// serviceKey() reads this at call time (see lib/crypto/keys.ts); route.ts now
// calls encryptJson/serviceKey directly (no longer goes through
// lib/coach/memory's persistMemory), so it needs a real-shaped dummy key.
process.env.SERVICE_ENC_KEY = "ab".repeat(32);

// Il gate "un umano = un coach" chiama AgentBook su World Chain: mockato, altrimenti
// ogni test farebbe una RPC reale e il route risponderebbe 503.
vi.mock("@/lib/world/agentbook", () => ({
  lookupHumanId: vi.fn(async () => ({ humanId: "human_demo" })),
}));

// Il gate è OPT-IN in produzione (REQUIRE_HUMAN_BACKED_MINT=1): la registrazione
// avviene in World App, quindi attivo per default bloccherebbe tutti. Questi test
// lo accendono di default perché è il comportamento con più regole da verificare,
// e lo spengono esplicitamente nei test della valvola.
process.env.REQUIRE_HUMAN_BACKED_MINT = "1";

/** True se la condizione drizzle (anche annidata in `and()`) tocca quella colonna. */
function mentions(cond: any, column: string): boolean {
  const chunks = cond?.queryChunks;
  if (!Array.isArray(chunks)) return false;
  return chunks.some((c: any) => c?.name === column || mentions(c, column));
}
/** Primo parametro stringa non vuoto della condizione (l'humanId cercato). */
function paramValue(cond: any): string | null {
  for (const c of cond?.queryChunks ?? []) {
    if (c && typeof c === "object" && typeof (c as any).value === "string" && (c as any).value) {
      return (c as any).value;
    }
    const nested = paramValue(c);
    if (nested) return nested;
  }
  return null;
}

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => ({ userId: 1, wallet: "0x" + "22".repeat(20), privyDid: "did:x" })) }));
vi.mock("@/lib/zerog/contracts", async (orig) => ({
  ...(await orig()) as object, // keep the real (pure, no env dependency) toBytes32
  mintCoachOnChain: vi.fn(async () => ({ tokenId: "1", txHash: "0xmint" })),
  updateRegistry: vi.fn(async () => "0xreg"),
}));
// Fire-and-forget bonus step (Task 4): mocked so these tests never make a real
// network call, and resolved with an error by default so the "never throws /
// never blocks the response" contract is exercised rather than assumed.
vi.mock("@/lib/erc8004/register", () => ({
  registerAgent: vi.fn(async () => ({ error: "not exercised in this test" })),
}));
// Same fire-and-forget bonus step, different network (Sepolia): mocked so
// these tests never make a real RPC call. slugifyLabel is the real, pure
// export — no reason to fake it, and the route's label-computation is worth
// exercising for real.
vi.mock("@/lib/ens/subname", async (orig) => ({
  ...(await orig()) as object,
  assignSubname: vi.fn(async () => ({ error: "not exercised in this test" })),
  // Writes a text record on Sepolia for real if left unmocked.
  setTextRecord: vi.fn(async () => ({ name: "kilian.0run.eth", txHash: "0xsettext" })),
}));

// Reservation semantics under test: a coaches row keyed by userId, with an
// empty tokenId meaning "reserved, mint not confirmed" (see the invariant
// comment in route.ts). Modeled as a Map since every test in this file uses
// the single fixed userId (1) from the requireUser mock above.
const dbState: { coaches: Map<number, any> } = { coaches: new Map() };
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (v: any) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (dbState.coaches.has(v.userId)) return [];
            // Il vincolo UNIQUE(human_id) in Postgres lancia una violazione, non
            // restituisce zero righe: il route deve tradurla in un 409 esplicito.
            if (v.humanId && [...dbState.coaches.values()].some((c: any) => c.humanId === v.humanId)) {
              throw Object.assign(new Error('duplicate key value violates unique constraint "coaches_human_id_unique"'), { code: "23505", constraint: "coaches_human_id_unique" });
            }
            // reservedAt is filled by the column default in Postgres, so the mock
            // must supply it too — the conflict path reads it to age the reservation.
            const row = { id: dbState.coaches.size + 1, reservedAt: new Date(), ...v };
            dbState.coaches.set(v.userId, row);
            return [{ id: row.id }];
          },
        }),
      }),
    }),
    // The conflict path reads the existing row to tell "already minted" from
    // "mint in flight" from "stale reservation to reclaim".
    select: () => ({
      from: () => ({
        where: async (cond: any) => {
          // Il route interroga per userId (il proprio account) oppure per humanId
          // (la riga che ha fatto scattare il conflitto, che può appartenere a un
          // ALTRO account della stessa persona): il mock deve distinguerli, o il
          // recupero di una prenotazione morta non è verificabile.
          if (mentions(cond, "human_id")) {
            const humanId = paramValue(cond);
            return [...dbState.coaches.values()].filter((c: any) => c.humanId === humanId);
          }
          const row = dbState.coaches.get(1);
          return row ? [row] : [];
        },
      }),
    }),
    update: () => ({
      set: (patch: any) => ({
        where: async () => {
          const row = dbState.coaches.get(1);
          if (row) Object.assign(row, patch);
        },
      }),
    }),
    delete: () => ({
      // Deletes are scoped to the unconfirmed placeholder (tokenId === ""), so a
      // confirmed coach must survive an abandon/reclaim attempt. The reclaim of a
      // reservation held by the same PERSON keys on humanId instead of userId.
      where: async (cond: any) => {
        if (mentions(cond, "human_id")) {
          const humanId = paramValue(cond);
          for (const [key, row] of dbState.coaches) {
            if (row.humanId === humanId && row.tokenId === "") dbState.coaches.delete(key);
          }
          return;
        }
        const row = dbState.coaches.get(1);
        if (row && row.tokenId === "") dbState.coaches.delete(1);
      },
    }),
  },
}));

import { mintCoachOnChain, updateRegistry } from "@/lib/zerog/contracts";
import { registerAgent } from "@/lib/erc8004/register";
import { assignSubname, setTextRecord } from "@/lib/ens/subname";
import { _setDepsForTest } from "@/lib/zerog/storage";

function req(body: any = { name: "Kilian", personality: "coach", userKeyHex: "aa".repeat(32) }) {
  return new Request("http://x/api/coach/mint", {
    method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify(body),
  });
}

describe("POST /api/coach/mint", () => {
  beforeEach(() => {
    dbState.coaches = new Map();
    vi.mocked(mintCoachOnChain).mockReset().mockImplementation(async () => ({ tokenId: "1", txHash: "0xmint" }));
    vi.mocked(updateRegistry).mockReset().mockImplementation(async () => "0xreg");
    vi.mocked(registerAgent).mockReset().mockImplementation(async () => ({ error: "not exercised in this test" }));
    vi.mocked(assignSubname).mockReset().mockImplementation(async () => ({ error: "not exercised in this test" }));
    vi.mocked(setTextRecord).mockReset().mockImplementation(async () => ({ name: "kilian.0run.eth", txHash: "0xsettext" }));
    // Root hashes are computed locally (fast, no network) — this is exactly
    // the fix under test, so the mock doUpload is never expected to be
    // awaited by the request/response cycle itself (only by the
    // fire-and-forget background upload).
    _setDepsForTest({
      makeData: async () => ({ data: {}, rootHash: "0x" + "1".repeat(64) }),
      doUpload: async () => ["0xstoragetx", null] as const,
      doDownload: async () => Buffer.from("x"),
    });
  });

  it("minta e ritorna explorer url", async () => {
    const { POST } = await import("./route");
    const res = await POST(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.tokenId).toBe("1");
    expect(body.explorerUrl).toContain("chainscan-galileo.0g.ai/tx/0xmint");
  });

  it("secondo mint → 409, e il mint on-chain non viene ritentato", async () => {
    const { POST } = await import("./route");
    await POST(req());
    const res2 = await POST(req());
    expect(res2.status).toBe(409);
    expect(vi.mocked(mintCoachOnChain)).toHaveBeenCalledTimes(1);
  });

  it("personalità invalida → 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ name: "K", personality: "hard", userKeyHex: "aa".repeat(32) }));
    expect(res.status).toBe(400);
  });

  it("userKeyHex non esadecimale (Buffer.from troncherebbe in silenzio) → 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ name: "K", personality: "coach", userKeyHex: "zz".repeat(32) }));
    expect(res.status).toBe(400);
  });

  it("userKeyHex di lunghezza sbagliata → 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(req({ name: "K", personality: "coach", userKeyHex: "aa" }));
    expect(res.status).toBe(400);
  });

  it("body non JSON → 400, non un 500 non gestito", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://x/api/coach/mint", {
      method: "POST", headers: { authorization: "Bearer t" }, body: "{not valid json",
    }));
    expect(res.status).toBe(400);
  });

  it("reservation già presente (insert ON CONFLICT DO NOTHING → []) → 409, mint MAI tentato", async () => {
    dbState.coaches.set(1, { id: 1, userId: 1, tokenId: "", name: "x", personality: "coach", memoryRoot: "", profileRoot: "", mintTx: "", reservedAt: new Date() });
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(vi.mocked(mintCoachOnChain)).not.toHaveBeenCalled();
  });

  // Il gate: possedere un agente richiede un umano unico verificato; consultare i
  // coach altrui no. Il vincolo sta sulla proprietà, non sull'accesso.
  it("wallet senza human backing → 403 e NESSUNA reservation creata", async () => {
    const { lookupHumanId } = await import("@/lib/world/agentbook");
    vi.mocked(lookupHumanId).mockResolvedValueOnce({ humanId: null });
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe("human_backing_required");
    expect(body.howTo).toContain("agentkit-cli register");
    expect(dbState.coaches.size).toBe(0);
    expect(vi.mocked(mintCoachOnChain)).not.toHaveBeenCalled();
  });

  it("AgentBook irraggiungibile → 503: 'non lo so' non diventa né un sì né un no", async () => {
    const { lookupHumanId } = await import("@/lib/world/agentbook");
    vi.mocked(lookupHumanId).mockResolvedValueOnce({ humanId: null, error: "RPC down" });
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(503);
    expect(dbState.coaches.size).toBe(0);
    expect(vi.mocked(mintCoachOnChain)).not.toHaveBeenCalled();
  });

  it("stesso humanId da un ALTRO account → 409: un umano, un solo coach", async () => {
    dbState.coaches.set(99, {
      id: 1, userId: 99, tokenId: "7", name: "altro", personality: "coach",
      memoryRoot: "0xm", profileRoot: "0xp", mintTx: "0xt", humanId: "human_demo", reservedAt: new Date(),
    });
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("human_already_owns_a_coach");
    expect(vi.mocked(mintCoachOnChain)).not.toHaveBeenCalled();
  });

  it("il brief del coach finisce sulla riga e nella description ENS", async () => {
    vi.mocked(assignSubname).mockImplementation(async () => ({ name: "kilian.0run.eth", txHash: "0xenstx" }));
    const { POST } = await import("./route");
    const res = await POST(
      req({ name: "Kilian", personality: "coach", userKeyHex: "aa".repeat(32), expertise: "trail ultras, heat adaptation" }),
    );
    expect(res.status).toBe(200);
    expect(dbState.coaches.get(1).expertise).toBe("trail ultras, heat adaptation");
    // È pubblico per scelta: è ciò che fa capire a un estraneo quale coach vale
    // la pena interrogare.
    const records = vi.mocked(assignSubname).mock.calls[0][2] as any;
    expect(records.description).toContain("trail ultras, heat adaptation");
  });

  it("senza brief niente 'Knows:' inventato nella description", async () => {
    vi.mocked(assignSubname).mockImplementation(async () => ({ name: "kilian.0run.eth", txHash: "0xenstx" }));
    const { POST } = await import("./route");
    expect((await POST(req())).status).toBe(200);
    const records = vi.mocked(assignSubname).mock.calls[0][2] as any;
    expect(records.description).not.toContain("Knows:");
  });

  it("un brief oltre il limite viene rifiutato con 400, non troncato di nascosto", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      req({ name: "Kilian", personality: "coach", userKeyHex: "aa".repeat(32), expertise: "x".repeat(401) }),
    );
    expect(res.status).toBe(400);
    expect(dbState.coaches.size).toBe(0);
  });

  it("una prenotazione morta della STESSA persona da un altro account viene recuperata, non blocca per sempre", async () => {
    // Account 99 ha prenotato (placeholder vuoti) ed è morto prima di finalizzare.
    // Il reclaim per userId non guarda mai questa riga: senza il recupero per
    // humanId, la persona resta bloccata su OGNI suo account, per sempre.
    dbState.coaches.set(99, {
      id: 1, userId: 99, tokenId: "", name: "morta", personality: "coach",
      memoryRoot: "", profileRoot: "", mintTx: "", humanId: "human_demo",
      reservedAt: new Date(Date.now() - 10 * 60_000),
    });
    const { POST } = await import("./route");
    expect((await POST(req())).status).toBe(200);
    expect(dbState.coaches.get(1).humanId).toBe("human_demo");
  });

  it("prenotazione RECENTE della stessa persona → 409 'in corso', non recuperata", async () => {
    dbState.coaches.set(99, {
      id: 1, userId: 99, tokenId: "", name: "in corso", personality: "coach",
      memoryRoot: "", profileRoot: "", mintTx: "", humanId: "human_demo", reservedAt: new Date(),
    });
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/in corso/);
    expect(dbState.coaches.has(99)).toBe(true);
    expect(vi.mocked(mintCoachOnChain)).not.toHaveBeenCalled();
  });

  it("un guasto del DB NON diventa 'possiedi già un coach': deve restare un 5xx", async () => {
    // Come drizzle riporta davvero un errore: wrapper il cui messaggio è l'intera
    // query (quindi cita SEMPRE human_id) e nessun code/constraint in cima. Un
    // test di sottostringa qui rispondeva 409 a un reset di connessione.
    const { db } = await import("@/db");
    const failing = Object.assign(
      new Error('Failed query: insert into "coaches" ("user_id", "human_id", ...) values ...'),
      { cause: Object.assign(new Error("Connection terminated unexpectedly"), { code: "ECONNRESET" }) },
    );
    const spy = vi.spyOn(db, "insert").mockImplementation((() => ({
      values: () => ({ onConflictDoNothing: () => ({ returning: async () => { throw failing; } }) }),
    })) as any);
    try {
      const { POST } = await import("./route");
      const res = await POST(req());
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(vi.mocked(mintCoachOnChain)).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("violazione di unicità annidata in un wrapper drizzle → 409, non 500", async () => {
    const { db } = await import("@/db");
    const wrapped = Object.assign(new Error("Failed query: insert into \"coaches\" ..."), {
      cause: Object.assign(new Error("duplicate key value"), {
        code: "23505",
        constraint: "coaches_human_id_unique",
      }),
    });
    let firstCall = true;
    const spy = vi.spyOn(db, "insert").mockImplementation((() => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (firstCall) { firstCall = false; throw wrapped; }
            return [{ id: 1 }];
          },
        }),
      }),
    })) as any);
    try {
      const { POST } = await import("./route");
      const res = await POST(req());
      expect(res.status).toBe(409);
      expect((await res.json()).reason).toBe("human_already_owns_a_coach");
    } finally {
      spy.mockRestore();
    }
  });

  it("gate NON applicato (default) → minta senza human backing e NON registra l'humanId", async () => {
    const saved = process.env.REQUIRE_HUMAN_BACKED_MINT;
    delete process.env.REQUIRE_HUMAN_BACKED_MINT;
    const { lookupHumanId } = await import("@/lib/world/agentbook");
    vi.mocked(lookupHumanId).mockResolvedValueOnce({ humanId: null });
    try {
      const { POST } = await import("./route");
      expect((await POST(req())).status).toBe(200);
      // Niente humanId: registrarlo farebbe applicare il vincolo UNIQUE che
      // questo flag dice di allentare, e la seconda persona vedrebbe un 409.
      expect(dbState.coaches.get(1).humanId).toBeNull();
    } finally {
      process.env.REQUIRE_HUMAN_BACKED_MINT = saved;
    }
  });

  it("gate non applicato + persona già registrata → l'humanId resta fuori dal DB", async () => {
    const saved = process.env.REQUIRE_HUMAN_BACKED_MINT;
    delete process.env.REQUIRE_HUMAN_BACKED_MINT;
    try {
      const { POST } = await import("./route");
      expect((await POST(req())).status).toBe(200);
      expect(dbState.coaches.get(1).humanId).toBeNull();
    } finally {
      process.env.REQUIRE_HUMAN_BACKED_MINT = saved;
    }
  });

  it("gate non applicato + AgentBook giù → minta comunque (altrimenti la valvola non serve a nulla)", async () => {
    const saved = process.env.REQUIRE_HUMAN_BACKED_MINT;
    delete process.env.REQUIRE_HUMAN_BACKED_MINT;
    const { lookupHumanId } = await import("@/lib/world/agentbook");
    vi.mocked(lookupHumanId).mockResolvedValueOnce({ humanId: null, error: "RPC down" });
    try {
      const { POST } = await import("./route");
      expect((await POST(req())).status).toBe(200);
    } finally {
      process.env.REQUIRE_HUMAN_BACKED_MINT = saved;
    }
  });

  it("mint riuscito → l'humanId finisce sulla riga del coach", async () => {
    const { POST } = await import("./route");
    expect((await POST(req())).status).toBe(200);
    expect(dbState.coaches.get(1).humanId).toBe("human_demo");
  });

  it("SERVICE_ENC_KEY malformata → 500 e NESSUNA reservation creata (altrimenti lockout permanente)", async () => {
    const saved = process.env.SERVICE_ENC_KEY;
    process.env.SERVICE_ENC_KEY = "troppo-corta";
    try {
      const { POST } = await import("./route");
      const res = await POST(req());
      expect(res.status).toBe(500);
      // Il bug riprodotto dalla review: la riga restava con tokenId "" e ogni
      // tentativo successivo rispondeva 409 per sempre.
      expect(dbState.coaches.has(1)).toBe(false);
      expect(vi.mocked(mintCoachOnChain)).not.toHaveBeenCalled();
    } finally {
      process.env.SERVICE_ENC_KEY = saved;
    }
    // Config corretta: il retry deve poter mintare.
    const { POST } = await import("./route");
    expect((await POST(req())).status).toBe(200);
  });

  it("reservation scaduta (processo morto a metà mint) → reclamata, il mint procede", async () => {
    const stale = new Date(Date.now() - 400_000); // oltre 3× il budget di 90s
    dbState.coaches.set(1, {
      id: 1, userId: 1, tokenId: "", name: "x", personality: "coach",
      memoryRoot: "", profileRoot: "", mintTx: "", reservedAt: stale,
    });
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(dbState.coaches.get(1).tokenId).toBe("1");
  });

  it("reservation fresca → 409 che dichiara il mint in corso, distinto da 'già mintato'", async () => {
    dbState.coaches.set(1, {
      id: 1, userId: 1, tokenId: "", name: "x", personality: "coach",
      memoryRoot: "", profileRoot: "", mintTx: "", reservedAt: new Date(),
    });
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/in corso/i);
    expect(body.mintInProgressForMs).toBeGreaterThanOrEqual(0);
    expect(vi.mocked(mintCoachOnChain)).not.toHaveBeenCalled();
  });

  it("mint on-chain fallisce → la reservation viene eliminata e l'errore è surfaced (no double mint al retry)", async () => {
    vi.mocked(mintCoachOnChain).mockRejectedValueOnce(new Error("rpc rejected tx"));
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/rpc rejected tx/);
    // Reservation freed: a retry must be able to reserve again, not 409.
    expect(dbState.coaches.has(1)).toBe(false);
  });

  it("updateRegistry fallisce DOPO che il mint è confermato → la reservation NON viene eliminata (eviterebbe un secondo mint)", async () => {
    vi.mocked(updateRegistry).mockRejectedValueOnce(new Error("registry rpc timeout"));
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/registry rpc timeout/);
    // The NFT is real (mintCoachOnChain succeeded) — the row must persist
    // with the real tokenId, not be deleted.
    const row = dbState.coaches.get(1);
    expect(row).toBeTruthy();
    expect(row.tokenId).toBe("1");
  });

  it("mint che eccede il budget di 90s → 504 onesto invece di lasciare che nginx tagli la connessione", async () => {
    vi.useFakeTimers();
    try {
      let resolveMint!: (v: { tokenId: string; txHash: string }) => void;
      vi.mocked(mintCoachOnChain).mockImplementationOnce(
        () => new Promise((resolve) => { resolveMint = resolve; }),
      );
      const { POST } = await import("./route");
      const pending = POST(req());
      await vi.advanceTimersByTimeAsync(90_000);
      const res = await pending;
      expect(res.status).toBe(504);
      const body = await res.json();
      expect(body.error).toMatch(/90s|previsto/i);
      // Outcome still unknown at this point — must not have been deleted
      // (could enable a double mint) nor finalized (mint hasn't resolved).
      expect(dbState.coaches.has(1)).toBe(true);
      expect(dbState.coaches.get(1)?.tokenId).toBe("");

      // The mint eventually lands: the route must finalize it in the
      // background rather than leaving the reservation stuck forever.
      resolveMint({ tokenId: "1", txHash: "0xmint" });
      await vi.advanceTimersByTimeAsync(0);
      for (let i = 0; i < 10; i++) await Promise.resolve();
      expect(dbState.coaches.get(1)?.tokenId).toBe("1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("registrazione ERC-8004 fallisce in background → il mint resta 200, nessun agentId scritto", async () => {
    vi.mocked(registerAgent).mockImplementation(async () => ({ error: "rpc down" }));
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    // Give the fire-and-forget background task a turn to settle.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(dbState.coaches.get(1)?.agentId).toBeUndefined();
  });

  it("registrazione ERC-8004 riesce in background → agentId persistito sulla riga coaches DOPO la risposta", async () => {
    let resolveRegister!: (v: { agentId: string; txHash: string }) => void;
    vi.mocked(registerAgent).mockImplementation(
      () => new Promise((resolve) => { resolveRegister = resolve; }),
    );
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    // Not yet settled: the response must not have waited on it.
    expect(dbState.coaches.get(1)?.agentId).toBeUndefined();
    expect(vi.mocked(registerAgent)).toHaveBeenCalledWith("1", "https://0run.fun/coach/1");

    resolveRegister({ agentId: "148", txHash: "0xreg8004" });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(dbState.coaches.get(1)?.agentId).toBe("148");
  });

  it("quando ENS e ERC-8004 sono entrambi arrivati, 0run:erc8004 viene pubblicato UNA volta", async () => {
    // I due passi sono indipendenti e l'ordine non è garantito: chi arriva
    // secondo scrive il record, e non si scrive due volte.
    vi.mocked(assignSubname).mockImplementation(async () => ({ name: "kilian.0run.eth", txHash: "0xenstx" }));
    vi.mocked(registerAgent).mockImplementation(async () => ({ agentId: "148", txHash: "0x8004tx" }));
    const { POST } = await import("./route");
    expect((await POST(req())).status).toBe(200);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(vi.mocked(setTextRecord)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setTextRecord)).toHaveBeenCalledWith("kilian.0run.eth", "0run:erc8004", "148");
  });

  it("solo ENS (ERC-8004 fallito) → nessun record 0run:erc8004 inventato", async () => {
    vi.mocked(assignSubname).mockImplementation(async () => ({ name: "kilian.0run.eth", txHash: "0xenstx" }));
    const { POST } = await import("./route");
    expect((await POST(req())).status).toBe(200);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(vi.mocked(setTextRecord)).not.toHaveBeenCalled();
  });

  it("assegnazione ENS fallisce in background → il mint resta 200, nessun ensName scritto", async () => {
    vi.mocked(assignSubname).mockImplementation(async () => ({ error: "sepolia rpc down" }));
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    // Give the fire-and-forget background task a turn to settle.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(dbState.coaches.get(1)?.ensName).toBeUndefined();
  });

  it("assegnazione ENS riesce in background → ensName persistito sulla riga coaches DOPO la risposta, con label derivata dal nome del coach", async () => {
    let resolveEns!: (v: { name: string; txHash: string }) => void;
    vi.mocked(assignSubname).mockImplementation(
      () => new Promise((resolve) => { resolveEns = resolve; }),
    );
    const { POST } = await import("./route");
    const res = await POST(req());
    expect(res.status).toBe(200);
    // Not yet settled: the response must not have waited on it.
    expect(dbState.coaches.get(1)?.ensName).toBeUndefined();
    expect(vi.mocked(assignSubname)).toHaveBeenCalledWith(
      "kilian",
      "0x" + "22".repeat(20),
      {
        tokenId: "1",
        endpoint: "https://0run.fun/coach/1",
        // The avatar record is what makes the portrait show up in ENS clients,
        // and description/url are the ENSIP-5 keys those clients actually read.
        avatar: "https://0run.fun/api/coach/1/avatar",
        url: "https://0run.fun/coach/1",
        description: expect.stringContaining("Kilian"),
        personality: "coach",
      },
    );

    resolveEns({ name: "kilian.0run.eth", txHash: "0xenstx" });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(dbState.coaches.get(1)?.ensName).toBe("kilian.0run.eth");
  });
});
