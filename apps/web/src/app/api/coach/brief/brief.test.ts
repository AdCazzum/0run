import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ userId: 1, wallet: "0x" + "22".repeat(20), privyDid: "did:x" })),
}));

const USER_KEY_HEX = "aa".repeat(32);
const state: { coachRows: any[]; patches: any[] } = { coachRows: [], patches: [] };

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => state.coachRows }) }),
    update: () => ({ set: (patch: any) => ({ where: async () => void state.patches.push(patch) }) }),
  },
}));

const persistMemoryMock = vi.fn(async (memory: any) => ({
  memory: { ok: true, rootHash: "0xnewmem", txHash: "0xtx1" },
  profile: { ok: true, rootHash: "0xnewprof", txHash: "0xtx2" },
  memoryCipher: "fresh-envelope",
  _persisted: memory,
}));
vi.mock("@/lib/coach/memory", async (orig) => ({
  ...((await orig()) as object),
  persistMemory: (...args: any[]) => persistMemoryMock(...(args as [any])),
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
      memoryRoot: "0xoldmem", profileRoot: "0xoldprof", mintTx: "0xmint",
      ensName: "k.0run.eth",
      memoryCipher: encryptJson(memory, Buffer.from(USER_KEY_HEX, "hex")),
    },
  ];
  state.patches = [];
  persistMemoryMock.mockClear();
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
    expect((persistMemoryMock.mock.calls[0][0] as any).coach.expertise).toBe("trail ultras, caldo");
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
    expect((persistMemoryMock.mock.calls[0][0] as any).coach.expertise).toBeUndefined();
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

  it("se la memoria non si riscrive, niente viene salvato", async () => {
    persistMemoryMock.mockImplementationOnce(async () => ({
      memory: { ok: false, error: "0G storage down" },
      profile: { ok: true, rootHash: "0xnewprof", txHash: "0xtx2" },
      memoryCipher: "",
    }) as any);
    const { PATCH } = await import("./route");
    expect((await PATCH(req({ expertise: "nuovo", userKeyHex: USER_KEY_HEX }))).status).toBe(502);
    expect(state.patches).toHaveLength(0);
    expect(setTextRecordMock).not.toHaveBeenCalled();
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
