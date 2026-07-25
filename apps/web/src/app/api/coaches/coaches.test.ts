import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENT_NFT_ADDRESS = "0x" + "ab".repeat(20);
process.env.AGENT_NFT_ADDRESS = AGENT_NFT_ADDRESS;
process.env.ZG_RPC_URL = "https://example.invalid";

// --- chain mock ------------------------------------------------------------
// route.ts -> lib/coach/directory.ts talks to `ethers` directly (no wrapper
// module to mock, same situation as lib/erc8004/register.test.ts). Only
// nextId/ownerOf are exercised by the directory's enumeration.
const nextIdFn = vi.fn();
const ownerOfFn = vi.fn();

vi.mock("ethers", () => ({
  ethers: {
    JsonRpcProvider: vi.fn().mockImplementation(function () {
      return {};
    }),
    Contract: vi.fn().mockImplementation(function () {
      return { nextId: nextIdFn, ownerOf: ownerOfFn };
    }),
  },
}));

// --- ENS mock ----------------------------------------------------------
// vi.mock factories are hoisted above top-level const declarations, so the
// mock fn itself must be created through vi.hoisted() rather than a plain
// `const` — otherwise this reference (used directly in the factory's return
// object, not deferred inside a nested closure like the ethers mock below)
// hits the TDZ before `resolveCoachEnsMock` is assigned.
const { resolveCoachEnsMock } = vi.hoisted(() => ({ resolveCoachEnsMock: vi.fn() }));
vi.mock("@/lib/ens/resolve", () => ({ resolveCoachEns: resolveCoachEnsMock }));

// --- drizzle-orm mock (same discipline as api/events/events.test.ts) -------
vi.mock("drizzle-orm", async (orig) => {
  const real = await orig<typeof import("drizzle-orm")>();
  return {
    ...real,
    eq: (col: any, val: any) => ({ __op: "eq", col, val }),
    count: () => ({ __op: "count" }),
  };
});

// --- db mock -----------------------------------------------------------
const state: { coaches: any[]; runsByUserId: Record<number, number> } = { coaches: [], runsByUserId: {} };

vi.mock("@/db", async () => {
  const schema = await import("@/db/schema");
  return {
    db: {
      select: (_proj?: any) => ({
        from: (table: any) => {
          if (table === schema.coaches) return Promise.resolve(state.coaches);
          if (table === schema.runs) {
            return {
              where: async (cond: any) => [{ value: state.runsByUserId[cond.val] ?? 0 }],
            };
          }
          return Promise.resolve([]);
        },
      }),
    },
  };
});

import { _resetDirectoryCacheForTest } from "@/lib/coach/directory";

function coachRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    userId: 1,
    tokenId: "1",
    name: "Nova",
    personality: "coach",
    memoryRoot: "0xm",
    profileRoot: "0xp",
    mintTx: "0xmint",
    memoryCipher: null,
    reservedAt: new Date(),
    agentId: null,
    ensName: null,
    ...overrides,
  };
}

describe("GET /api/coaches", () => {
  beforeEach(() => {
    _resetDirectoryCacheForTest();
    state.coaches = [];
    state.runsByUserId = {};
    nextIdFn.mockReset();
    ownerOfFn.mockReset();
    resolveCoachEnsMock.mockReset();
  });

  it("enumerazione + risoluzione mockate → le entry on-chain vengono restituite", async () => {
    nextIdFn.mockResolvedValue(2n); // solo tokenId 1 esiste
    ownerOfFn.mockResolvedValue("0x" + "11".repeat(20));
    state.coaches = [coachRow({ tokenId: "1", userId: 1, ensName: "nova.0run.eth" })];
    state.runsByUserId = { 1: 4 };
    resolveCoachEnsMock.mockResolvedValue({
      address: "0x" + "11".repeat(20),
      records: {
        "agent-context": "0run coach",
        "agent-endpoint[web]": "https://0run.fun/coach/1",
        "0run:inft": `16602:${AGENT_NFT_ADDRESS}:1`,
      },
    });

    const { GET } = await import("./route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.coaches).toHaveLength(1);
    expect(body.coaches[0]).toMatchObject({
      tokenId: "1",
      owner: "0x" + "11".repeat(20),
      displayName: "nova.0run.eth",
      personality: "coach",
      runCount: 4,
      mismatch: false,
    });
  });

  it("risoluzione ENS fallita per un'entry → resta elencata, nome null (mai inventato)", async () => {
    nextIdFn.mockResolvedValue(2n);
    ownerOfFn.mockResolvedValue("0x" + "22".repeat(20));
    state.coaches = [coachRow({ tokenId: "1", userId: 1, ensName: "broken.0run.eth" })];
    resolveCoachEnsMock.mockResolvedValue({ address: null, records: {} });

    const { GET } = await import("./route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.coaches).toHaveLength(1);
    expect(body.coaches[0].tokenId).toBe("1");
    expect(body.coaches[0].displayName).toBeNull();
  });

  it("record 0run:inft che non combacia con l'agente on-chain reale → flaggato mismatch, non scartato", async () => {
    nextIdFn.mockResolvedValue(2n);
    ownerOfFn.mockResolvedValue("0x" + "33".repeat(20));
    state.coaches = [coachRow({ tokenId: "1", userId: 1, ensName: "nova.0run.eth" })];
    resolveCoachEnsMock.mockResolvedValue({
      address: "0x" + "33".repeat(20),
      records: { "0run:inft": "16602:0xSomeOtherContract:999" },
    });

    const { GET } = await import("./route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.coaches).toHaveLength(1);
    expect(body.coaches[0].mismatch).toBe(true);
  });

  it("nessun coach mintato (nextId=1) → lista vuota onesta, 200", async () => {
    nextIdFn.mockResolvedValue(1n);
    const { GET } = await import("./route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.coaches).toEqual([]);
  });

  it("fallimento RPC → errore onesto, mai una lista vuota spacciata per 'nessun coach'", async () => {
    nextIdFn.mockRejectedValue(new Error("rpc down"));
    const { GET } = await import("./route");
    const res = await GET();
    const body = await res.json();
    expect(res.status).not.toBe(200);
    expect(body.error).toBeTruthy();
    expect(body.coaches).toBeUndefined();
  });

  it("cache in-process: una seconda GET entro 60s non richiama di nuovo nextId", async () => {
    nextIdFn.mockResolvedValue(1n);
    const { GET } = await import("./route");
    await GET();
    await GET();
    expect(nextIdFn).toHaveBeenCalledTimes(1);
  });

  it("un fallimento non viene mai messo in cache: la chiamata successiva ritenta davvero", async () => {
    nextIdFn.mockRejectedValueOnce(new Error("rpc down")).mockResolvedValueOnce(1n);
    const { GET } = await import("./route");
    const first = await GET();
    expect(first.status).not.toBe(200);
    const second = await GET();
    const secondBody = await second.json();
    expect(second.status).toBe(200);
    expect(secondBody.coaches).toEqual([]);
    expect(nextIdFn).toHaveBeenCalledTimes(2);
  });
});
