import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ userId: 1, wallet: "0x" + "22".repeat(20), privyDid: "did:x" })),
}));

const USER_KEY_HEX = "aa".repeat(32);
const GPX_ROOT = "0xgpxroot";

const state: {
  runRows: any[];
  coachRows: any[];
  deletedRuns: number;
  coachPatches: any[];
} = { runRows: [], coachRows: [], deletedRuns: 0, coachPatches: [] };

vi.mock("@/db", async () => {
  const schema = await import("@/db/schema");
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: async () => (table === schema.coaches ? state.coachRows : state.runRows),
        }),
      }),
      update: () => ({ set: (patch: any) => ({ where: async () => void state.coachPatches.push(patch) }) }),
      delete: (table: unknown) => ({
        where: async () => {
          if (table === schema.runs) state.deletedRuns++;
        },
      }),
    },
  };
});

// The memory is real ciphertext the route decrypts for real (that is the point
// of the flow); only the network-bound persistence is faked.
const persistMemoryMock = vi.fn(async (memory: any) => ({
  memory: { ok: true, rootHash: "0xnewmem", txHash: "0xtx1" },
  profile: { ok: true, rootHash: "0xnewprof", txHash: "0xtx2" },
  memoryCipher: "fresh-envelope",
  // exposed for assertions on what was persisted
  _persisted: memory,
}));
vi.mock("@/lib/coach/memory", async (orig) => ({
  ...((await orig()) as object),
  persistMemory: (...args: any[]) => persistMemoryMock(...(args as [any])),
}));

const updateRegistryMock = vi.fn(async () => "0xanchor");
vi.mock("@/lib/zerog/contracts", async (orig) => ({
  ...((await orig()) as object),
  updateRegistry: updateRegistryMock,
}));

import { encryptJson } from "@/lib/crypto/aes";
import { appendRun } from "@/lib/coach/memory";
import { initialMemory } from "@0run/shared";

const runSummary = {
  distanceKm: 5, durationSec: 1500, avgPaceSecKm: 300, elevationGainM: 40,
  splitsSecKm: [300], avgHr: 150, startedAt: "2026-07-20T07:30:00.000Z", reportHeadline: "",
  gpxRoot: GPX_ROOT, gpxContentHash: "0x" + "ab".repeat(32), report: null, feelings: null,
};

function req(body: unknown = { userKeyHex: USER_KEY_HEX }) {
  return new Request("http://x/api/runs/7", {
    method: "DELETE",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: "7" }) };

beforeEach(() => {
  const { memory } = initialMemory("K", "coach", "trail ultras");
  state.runRows = [{ id: 7, userId: 1, status: "done", gpxRoot: GPX_ROOT }];
  state.coachRows = [
    {
      id: 1, userId: 1, tokenId: "3", name: "K", personality: "coach",
      memoryRoot: "0xoldmem", profileRoot: "0xoldprof", mintTx: "0xmint",
      memoryCipher: encryptJson(appendRun(memory, runSummary), Buffer.from(USER_KEY_HEX, "hex")),
    },
  ];
  state.deletedRuns = 0;
  state.coachPatches = [];
  persistMemoryMock.mockClear();
  updateRegistryMock.mockReset().mockResolvedValue("0xanchor");
});

describe("DELETE /api/runs/[id]", () => {
  it("toglie la corsa dalla memoria cifrata, poi cancella la riga, poi ri-ancora on-chain", async () => {
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), params);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
    expect(body.memoryUpdated).toBe(true);
    expect(body.registryTx).toBe("0xanchor");
    // La corsa non è più nella memoria riscritta…
    const persisted = persistMemoryMock.mock.calls[0][0] as any;
    expect(persisted.privateLayer.runs).toHaveLength(0);
    // …e il brief del coach non è stato toccato.
    expect(persisted.coach.expertise).toBe("trail ultras");
    expect(state.deletedRuns).toBe(1);
    expect(state.coachPatches[0].memoryRoot).toBe("0xnewmem");
  });

  it("dice cosa NON può essere annullato, invece di far finta", async () => {
    const { DELETE } = await import("./route");
    const body = await (await DELETE(req(), params)).json();
    expect(body.note).toMatch(/0G Storage/);
    expect(body.note).toMatch(/nessuno, noi compresi/i);
  });

  it("se la memoria non si riscrive, la corsa NON viene cancellata", async () => {
    persistMemoryMock.mockImplementationOnce(async () => ({
      memory: { ok: false, error: "0G storage down" },
      profile: { ok: true, rootHash: "0xnewprof", txHash: "0xtx2" },
      memoryCipher: "",
    }) as any);
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), params);
    expect(res.status).toBe(502);
    expect(state.deletedRuns).toBe(0);
  });

  it("l'ancoraggio on-chain fallito non blocca la cancellazione (si ri-ancora alla prossima corsa)", async () => {
    updateRegistryMock.mockRejectedValueOnce(new Error("galileo rpc down"));
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), params);
    expect(res.status).toBe(200);
    expect((await res.json()).registryTx).toBeNull();
    expect(state.deletedRuns).toBe(1);
  });

  it("una corsa senza gpxRoot (pipeline morta prima dello store) si cancella senza toccare la memoria", async () => {
    state.runRows = [{ id: 7, userId: 1, status: "error", gpxRoot: null }];
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), params);
    expect(res.status).toBe(200);
    expect((await res.json()).memoryUpdated).toBe(false);
    expect(persistMemoryMock).not.toHaveBeenCalled();
    expect(state.deletedRuns).toBe(1);
  });

  it("la corsa di un altro utente non si cancella: è 404", async () => {
    state.runRows = []; // la query è già filtrata per userId
    const { DELETE } = await import("./route");
    expect((await DELETE(req(), params)).status).toBe(404);
    expect(state.deletedRuns).toBe(0);
  });

  it("senza userKeyHex valido → 400, niente cancellato", async () => {
    const { DELETE } = await import("./route");
    expect((await DELETE(req({ userKeyHex: "nope" }), params)).status).toBe(400);
    expect(state.deletedRuns).toBe(0);
  });
});
