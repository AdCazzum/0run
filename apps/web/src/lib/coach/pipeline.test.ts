import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CoachMemory } from "@0run/shared";

// --- db mock -----------------------------------------------------------
// Captures every `runs` step/status write (stepLog) and every `coaches`
// row write (coachUpdates), so tests can assert both the pipeline's
// step-machine AND what actually got cached for the next run.
const stepLog: Record<string, any> = {};
const coachUpdates: any[] = [];
let coachRow: any;

vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (v: any) => ({
        where: async () => {
          if (v.steps) stepLog.last = v.steps;
          if (v.status) stepLog.status = v.status;
          if ("memoryCipher" in v || "memoryRoot" in v) coachUpdates.push(v);
        },
      }),
    }),
    select: () => ({ from: () => ({ where: () => [coachRow] }) }),
  },
}));

vi.mock("../zerog/storage", () => ({
  uploadEncrypted: vi.fn(async () => ({ ok: true, rootHash: "0xgpxroot", txHash: "0xgpxtx" })),
  // AMENDMENT 1 evidence: a freshly uploaded blob is not downloadable for
  // 16+ minutes on real Galileo (docs/0g-reality-check.md). The happy path
  // must never call this — if it does, tests fail loudly instead of
  // silently relying on incidental mock behaviour.
  downloadDecrypted: vi.fn(async () => {
    throw new Error("downloadDecrypted must not be called when coaches.memoryCipher is cached");
  }),
}));

const decryptedMemory = { version: 1, coach: { name: "K", personality: "coach" }, privateLayer: { runs: [] } };
vi.mock("../crypto/aes", async (orig) => ({
  ...(await orig()) as object,
  decryptJson: vi.fn(() => decryptedMemory),
}));

vi.mock("../zerog/contracts", async (orig) => ({
  ...(await orig()) as object, // keep the real (pure, no env dependency) toBytes32
  updateRegistry: vi.fn(async () => "0xreg"),
}));

vi.mock("../inference", () => ({
  completeJson: vi.fn(async () => ({
    value: { headline: "H", analysis: "A", comparison: "C", advice: ["x"] },
    meta: { verified: true, model: "glm-5.2", path: "direct", text: "" },
  })),
}));

// persistMemory is the only thing mocked from ./memory: appendRun/buildProfile
// are pure and exercised for real, but persistMemory needs SERVICE_ENC_KEY
// (env, not set in test) to encrypt the profile layer — mocking it avoids
// that dependency entirely, same pattern as mint.test.ts.
const persistMemoryMock = vi.fn(async (_memory: CoachMemory, _userKey: Buffer) => ({
  memory: { ok: true, rootHash: "0xnewmem", txHash: "0xtx1" },
  profile: { ok: true, rootHash: "0xnewprof", txHash: "0xtx2" },
  memoryCipher: "fresh-cipher-envelope",
}));
vi.mock("./memory", async (orig) => ({
  ...(await orig()) as object,
  persistMemory: persistMemoryMock,
}));

const gpx = readFileSync(join(__dirname, "../gpx/fixtures/short-run.gpx"), "utf8");

describe("processRun", () => {
  beforeEach(() => {
    for (const k of Object.keys(stepLog)) delete stepLog[k];
    coachUpdates.length = 0;
    persistMemoryMock.mockClear();
    coachRow = {
      id: 1, userId: 1, tokenId: "1", name: "K", personality: "coach",
      memoryRoot: "0xm", profileRoot: "0xp", mintTx: "0xmint",
      memoryCipher: "cached-cipher-envelope",
    };
  });

  it("completa tutti gli step e salva il report usando la memoria in cache (mai downloadDecrypted)", async () => {
    const { processRun } = await import("./pipeline");
    const { downloadDecrypted } = await import("../zerog/storage");
    const { decryptJson } = await import("../crypto/aes");

    await processRun(1, 1, gpx, Buffer.alloc(32));

    expect(stepLog.status).toBe("done");
    expect(downloadDecrypted).not.toHaveBeenCalled();
    // decrypted straight from the cached envelope, not from a downloaded buffer
    expect(decryptJson).toHaveBeenCalledWith("cached-cipher-envelope", expect.anything(), expect.anything());

    // AMENDMENT 2 evidence: gpxRoot/gpxContentHash/report land on the
    // RunSummary the pipeline appends to memory before persisting it.
    expect(persistMemoryMock).toHaveBeenCalledTimes(1);
    const [updatedMemory] = persistMemoryMock.mock.calls[0];
    const appended = updatedMemory.privateLayer.runs.at(-1)!;
    expect(appended).toBeDefined();
    expect(appended.gpxRoot).toBe("0xgpxroot");
    expect(appended.gpxContentHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(appended.report).toBeNull(); // inference runs after this append; documented gap

    // DB cache gets refreshed with the new roots + the fresh envelope in the same update.
    const coachUpdate = coachUpdates.find((u) => u.memoryCipher);
    expect(coachUpdate).toMatchObject({
      memoryRoot: "0xnewmem", profileRoot: "0xnewprof", memoryCipher: "fresh-cipher-envelope",
    });
  });

  it("coaches.memoryCipher assente → fallback su downloadDecrypted (percorso re-sync)", async () => {
    coachRow.memoryCipher = null;
    const storage = await import("../zerog/storage");
    (storage.downloadDecrypted as any).mockImplementationOnce(async (rootHash: string) => {
      expect(rootHash).toBe("0xm"); // coach.memoryRoot, non il cache
      return { ok: true, data: Buffer.from(JSON.stringify({})) };
    });

    const { processRun } = await import("./pipeline");
    await processRun(1, 1, gpx, Buffer.alloc(32));

    expect(storage.downloadDecrypted).toHaveBeenCalledTimes(1);
    expect(stepLog.status).toBe("done");
  });

  it("GPX rotto → status error, mai throw", async () => {
    const { processRun } = await import("./pipeline");
    await expect(processRun(1, 1, "non gpx", Buffer.alloc(32))).resolves.toBeUndefined();
    expect(stepLog.status).toBe("error");
  });
});
