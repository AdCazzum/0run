import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ userId: 1, wallet: "0x" + "22".repeat(20), privyDid: "did:x" })),
}));

const USER_KEY_HEX = "aa".repeat(32);
const state: { coachRows: any[]; patches: any[]; commitWins: boolean } = {
  coachRows: [],
  patches: [],
  commitWins: true,
};

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => state.coachRows }) }),
    update: () => ({
      set: (patch: any) => ({
        // commitMemory reads the returned rows to tell "my write landed" from
        // "someone else's landed first".
        where: () => {
          const rows = state.commitWins ? [{ id: 1 }] : [];
          if (rows.length) state.patches.push(patch);
          const p: any = Promise.resolve(rows);
          p.returning = async () => rows;
          return p;
        },
      }),
    }),
  },
}));

const uploadMock = vi.fn(async () => ({ memory: { ok: true }, profile: { ok: true } }));
const prepareMemoryCommitMock = vi.fn(async (memory: any) => ({
  memoryRoot: "0xnewmem",
  profileRoot: "0xnewprof",
  memoryCipher: "fresh-memory-envelope",
  profileCipher: "fresh-profile-envelope",
  upload: uploadMock,
  _persisted: memory,
}));
vi.mock("@/lib/coach/memory", async (orig) => ({
  ...((await orig()) as object),
  prepareMemoryCommit: (...args: any[]) => prepareMemoryCommitMock(...(args as [any])),
}));

vi.mock("@/lib/zerog/contracts", async (orig) => ({
  ...((await orig()) as object),
  updateRegistry: vi.fn(async () => "0xanchor"),
}));

// Full parameter list declared even though unused: a zero-arg mock infers an
// empty tuple and tsc rejects the pass-through below (same fix as the runs
// route test's processRunMock).
const setTextRecordMock = vi.fn(
  async (_name: string, _key: string, _value: string): Promise<{ name: string; txHash: string } | { error: string }> => ({
    name: "k.0run.eth",
    txHash: "0xens",
  }),
);
vi.mock("@/lib/ens/subname", async (orig) => ({
  ...((await orig()) as object),
  setTextRecord: (...args: any[]) => setTextRecordMock(...(args as [any, any, any])),
}));

import { encryptJson } from "@/lib/crypto/aes";
import { initialMemory } from "@0run/shared";

function req(body: unknown) {
  return new Request("http://x/api/coach/brief", {
    method: "PATCH",
    headers: { authorization: "Bearer t", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  const { memory } = initialMemory("K", "coach", "prima versione");
  state.coachRows = [
    {
      id: 1, userId: 1, tokenId: "3", name: "K", personality: "coach",
      // The plaintext column mirrors what is inside the memory: the route
      // compares against it to avoid an ENS write for an unchanged brief.
      expertise: "prima versione",
      memoryRoot: "0xoldmem", profileRoot: "0xoldprof", mintTx: "0xmint",
      ensName: "k.0run.eth",
      memoryCipher: encryptJson(memory, Buffer.from(USER_KEY_HEX, "hex")),
    },
  ];
  state.patches = [];
  prepareMemoryCommitMock.mockClear();
  uploadMock.mockClear();
  state.commitWins = true;
  setTextRecordMock.mockReset().mockResolvedValue({ name: "k.0run.eth", txHash: "0xens" });
});

describe("PATCH /api/coach/brief", () => {
  it("riscrive il brief nella memoria cifrata, nella colonna pubblica e nella description ENS", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ expertise: "trail ultras, caldo", userKeyHex: USER_KEY_HEX }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.expertise).toBe("trail ultras, caldo");
    // La fonte è la memoria: è quella che legge il modello.
    expect((prepareMemoryCommitMock.mock.calls[0][0] as any).coach.expertise).toBe("trail ultras, caldo");
    // La colonna pubblica segue, perché le pagine pubbliche non decifrano nulla.
    expect(state.patches[0].expertise).toBe("trail ultras, caldo");
    // E il nome ENS racconta la stessa cosa a chi non passa da noi.
    expect(setTextRecordMock).toHaveBeenCalledWith("k.0run.eth", "description", expect.stringContaining("trail ultras, caldo"));
  });

  it("un brief svuotato viene rimosso davvero, non salvato come stringa vuota", async () => {
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ expertise: "   ", userKeyHex: USER_KEY_HEX }));

    expect(res.status).toBe(200);
    expect((await res.json()).expertise).toBeNull();
    expect((prepareMemoryCommitMock.mock.calls[0][0] as any).coach.expertise).toBeUndefined();
    expect(state.patches[0].expertise).toBeNull();
    expect(setTextRecordMock).toHaveBeenCalledWith("k.0run.eth", "description", expect.not.stringContaining("Knows:"));
  });

  it("se ENS non risponde, il brief resta salvato e l'errore viene detto", async () => {
    setTextRecordMock.mockResolvedValueOnce({ error: "sepolia rpc down" });
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ expertise: "nuovo", userKeyHex: USER_KEY_HEX }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.expertise).toBe("nuovo");
    expect(body.ens.error).toMatch(/sepolia rpc down/);
    expect(state.patches[0].expertise).toBe("nuovo");
  });

  it("se qualcun altro ha riscritto la memoria nel frattempo → 409, niente salvato", async () => {
    state.commitWins = false;
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ expertise: "nuovo", userKeyHex: USER_KEY_HEX }));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("memory_conflict");
    expect(state.patches).toHaveLength(0);
    expect(setTextRecordMock).not.toHaveBeenCalled();
  });

  it("aggiorna ANCHE profileCipher: è la copia che legge chi consulta il coach", async () => {
    const { PATCH } = await import("./route");
    await PATCH(req({ expertise: "trail ultras", userKeyHex: USER_KEY_HEX }));
    expect(state.patches[0]).toMatchObject({
      memoryCipher: "fresh-memory-envelope",
      profileCipher: "fresh-profile-envelope",
    });
  });

  it("l'upload su 0G parte dopo la risposta, non dentro la richiesta", async () => {
    const { PATCH } = await import("./route");
    await PATCH(req({ expertise: "trail ultras", userKeyHex: USER_KEY_HEX }));
    expect(uploadMock).toHaveBeenCalled();
  });

  it("ri-salvare lo STESSO testo non manda una transazione ENS", async () => {
    // Il wallet ENS è uno solo per tutto il deployment: una scrittura ripetibile
    // a piacere dall'utente è il modo in cui resta senza fondi.
    state.coachRows = [{ ...state.coachRows[0], expertise: "identico" }];
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ expertise: "identico", userKeyHex: USER_KEY_HEX }));
    expect(res.status).toBe(200);
    expect(setTextRecordMock).not.toHaveBeenCalled();
    expect((await res.json()).ens.skipped).toMatch(/invariato/);
  });

  it("coach senza nome ENS: lo dichiara invece di tacere", async () => {
    state.coachRows = [{ ...state.coachRows[0], ensName: null }];
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ expertise: "nuovo", userKeyHex: USER_KEY_HEX }));
    expect(res.status).toBe(200);
    expect((await res.json()).ens.skipped).toMatch(/non ha ancora un nome ENS/);
  });

  it("chiave sbagliata → 400 leggibile, mai un 500 con le interiora di node", async () => {
    state.coachRows = [
      { ...state.coachRows[0], memoryCipher: encryptJson({ v: 1 }, Buffer.from("bb".repeat(32), "hex")) },
    ];
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ expertise: "nuovo", userKeyHex: USER_KEY_HEX }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/chiave errata/);
    expect(state.patches).toHaveLength(0);
  });

  it("ancoraggio on-chain fallito → salvato, ma dichiarato", async () => {
    const { updateRegistry } = await import("@/lib/zerog/contracts");
    vi.mocked(updateRegistry).mockRejectedValueOnce(new Error("galileo rpc down"));
    const { PATCH } = await import("./route");
    const res = await PATCH(req({ expertise: "nuovo", userKeyHex: USER_KEY_HEX }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.anchored).toBe(false);
    expect(body.anchorError).toMatch(/galileo rpc down/);
  });

  it("un brief oltre il limite → 400, mai troncato di nascosto", async () => {
    const { PATCH } = await import("./route");
    expect((await PATCH(req({ expertise: "x".repeat(401), userKeyHex: USER_KEY_HEX }))).status).toBe(400);
    expect(state.patches).toHaveLength(0);
  });

  it("senza coach → 404", async () => {
    state.coachRows = [];
    const { PATCH } = await import("./route");
    expect((await PATCH(req({ expertise: "nuovo", userKeyHex: USER_KEY_HEX }))).status).toBe(404);
  });

  it("mint non confermato (tokenId vuoto) → 409, niente riscritto", async () => {
    state.coachRows = [{ ...state.coachRows[0], tokenId: "" }];
    const { PATCH } = await import("./route");
    expect((await PATCH(req({ expertise: "nuovo", userKeyHex: USER_KEY_HEX }))).status).toBe(409);
    expect(state.patches).toHaveLength(0);
  });
});
