import { beforeEach, describe, expect, it, vi } from "vitest";

// serviceKey() reads this at call time (see lib/crypto/keys.ts); route.ts now
// calls encryptJson/serviceKey directly (no longer goes through
// lib/coach/memory's persistMemory), so it needs a real-shaped dummy key.
process.env.SERVICE_ENC_KEY = "ab".repeat(32);

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
        where: async () => {
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
      // confirmed coach must survive an abandon/reclaim attempt.
      where: async () => {
        const row = dbState.coaches.get(1);
        if (row && row.tokenId === "") dbState.coaches.delete(1);
      },
    }),
  },
}));

import { mintCoachOnChain, updateRegistry } from "@/lib/zerog/contracts";
import { registerAgent } from "@/lib/erc8004/register";
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
});
