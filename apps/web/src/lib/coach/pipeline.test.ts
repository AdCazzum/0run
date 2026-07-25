import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CoachMemory } from "@0run/shared";
import type { ScoreOutcome } from "./score";

// --- db mock -----------------------------------------------------------
// Captures every `runs` step/status write (stepLog) and every `coaches`
// row write (coachUpdates), so tests can assert both the pipeline's
// step-machine AND what actually got cached for the next run.
const stepLog: Record<string, any> = {};
// Flip to false to make the compare-and-swap in commitMemory lose its race.
let memoryCommitWins = true;
/**
 * An UPDATE result that can be awaited directly OR have .returning() called on
 * it — commitMemory (lib/coach/commit.ts) uses the returned rows to tell "my
 * write landed" from "someone else's landed first", and a fake that only
 * supports `await where()` would make every compare-and-swap look like a loss.
 */
function updateResult(rows: any[] = [{ id: 1 }]) {
  const p: any = Promise.resolve(rows);
  p.returning = async () => rows;
  return p;
}

const coachUpdates: any[] = [];
let coachRow: any;

vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (v: any) => ({
        where: () => {
          if (v.steps) stepLog.last = v.steps;
          if (v.status) stepLog.status = v.status;
          if ("effortScore" in v || "scoreNote" in v || "scoreVerified" in v) stepLog.scoreWrite = v;
          if ("memoryCipher" in v || "memoryRoot" in v) coachUpdates.push(v);
          if ("feelingsCipher" in v) stepLog.feelingsCipherWrite = v.feelingsCipher;
          return updateResult(memoryCommitWins ? [{ id: 1 }] : []);
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

// scoreRun (attested effort score, TEE-verified "direct" path — see
// ./score.ts) is mocked at the module boundary rather than exercised for
// real: pipeline tests must not depend on live inference (DIRECT_PROVIDERS
// is unset here), and scoreRun's own behaviour is unit-tested in
// score.test.ts. Defaults to success; the "score fallita" test below
// overrides this to the unavailable outcome.
const scoreRunMock = vi.fn<() => Promise<ScoreOutcome>>(async () => ({
  ok: true, score: 4, note: "sforzo alto", verified: true, model: "qwen2.5-omni-7b",
}));
vi.mock("./score", () => ({ scoreRun: scoreRunMock }));

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
    scoreRunMock.mockClear();
    scoreRunMock.mockResolvedValue({
      ok: true as const, score: 4 as const, note: "sforzo alto", verified: true, model: "qwen2.5-omni-7b",
    });
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

    // Attested effort score: computed BEFORE inference (so it can be cited in
    // the report prompt) and persisted alongside it.
    expect(scoreRunMock).toHaveBeenCalledTimes(1);
    expect(stepLog.last.score).toMatchObject({ status: "done" });
    expect(stepLog.scoreWrite).toMatchObject({ effortScore: 4, scoreNote: "sforzo alto", scoreVerified: "true" });
  });

  it("score non disponibile → NON fa fallire la corsa, inference completa comunque", async () => {
    scoreRunMock.mockResolvedValue({ ok: false, error: "direct: tutti i provider falliti" });
    const { processRun } = await import("./pipeline");

    await processRun(1, 1, gpx, Buffer.alloc(32));

    // The run as a whole still succeeds — the score is an enhancement, not a
    // requirement — and inference (the report) still runs to completion.
    expect(stepLog.status).toBe("done");
    expect(stepLog.last.score).toMatchObject({ status: "error", detail: "direct: tutti i provider falliti" });
    expect(stepLog.last.inference).toMatchObject({ status: "done" });
    expect(stepLog.scoreWrite).toBeUndefined(); // no score fields persisted when unavailable
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

  it("con feelings: la ciphertext viene scritta sulla riga e il testo in chiaro finisce nella memoria appesa", async () => {
    const { processRun } = await import("./pipeline");

    await processRun(1, 1, gpx, Buffer.alloc(32), "legs felt heavy today");

    expect(stepLog.status).toBe("done");
    expect(typeof stepLog.feelingsCipherWrite).toBe("string");
    expect(stepLog.feelingsCipherWrite.length).toBeGreaterThan(0);
    // The row must hold ciphertext ONLY — the plaintext must never appear verbatim on it.
    expect(stepLog.feelingsCipherWrite).not.toContain("legs felt heavy today");

    const [updatedMemory] = persistMemoryMock.mock.calls[0];
    const appended = updatedMemory.privateLayer.runs.at(-1)!;
    expect(appended.feelings).toBe("legs felt heavy today");
  });

  it("senza feelings: comportamento identico a prima (nessuna ciphertext, feelings null in memoria)", async () => {
    const { processRun } = await import("./pipeline");

    await processRun(1, 1, gpx, Buffer.alloc(32));

    expect(stepLog.status).toBe("done");
    expect(stepLog.feelingsCipherWrite).toBeNull();

    const [updatedMemory] = persistMemoryMock.mock.calls[0];
    const appended = updatedMemory.privateLayer.runs.at(-1)!;
    expect(appended.feelings).toBeNull();
  });
});
