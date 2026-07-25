import { beforeEach, describe, expect, it, vi } from "vitest";

// Tutte le fixture qui sotto sono sintetiche (inventate per il test), MAI l'export
// reale: è gitignored, contiene dati sanitari veri e il repo è pubblico (vedi
// docs/superpowers/specs/2026-07-25-health-data-spec.md §9).

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ userId: 1, wallet: "0x" + "22".repeat(20), privyDid: "did:x" })),
}));

let coachRow: any;
const dbUpdates: any[] = [];
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: async () => (coachRow ? [coachRow] : []) }) }),
    update: () => ({
      set: (v: any) => ({
        where: async () => {
          dbUpdates.push(v);
          if (coachRow) Object.assign(coachRow, v);
        },
      }),
    }),
  },
}));

// Same convention as pipeline.test.ts/chat.test.ts: decryptJson is mocked at
// the module boundary (real AES-GCM decryption needs matching ciphertext,
// which isn't the point of these tests) — parseMemory/setHealthSnapshot
// downstream stay REAL, so v1->v2 migration and the health-snapshot merge
// are exercised for real.
let decryptedMemoryToReturn: any = {
  version: 2, coach: { name: "K", personality: "coach" }, privateLayer: { runs: [], healthSnapshot: null },
};
const decryptJsonMock = vi.fn(() => decryptedMemoryToReturn);
vi.mock("@/lib/crypto/aes", async (orig) => ({
  ...(await orig()) as object,
  decryptJson: decryptJsonMock,
}));

// persistMemory is the only thing mocked from ./memory (same reasoning as
// pipeline.test.ts: it needs SERVICE_ENC_KEY + real 0G Storage network
// calls) — parseMemory/setHealthSnapshot are exercised for real below.
const persistMemoryMock = vi.fn(async (_memory: any, _userKey: Buffer) => ({
  memory: { ok: true, rootHash: "0xnewmem", txHash: "0xtx1" },
  profile: { ok: true, rootHash: "0xnewprof", txHash: "0xtx2" },
  memoryCipher: "fresh-cipher-envelope",
}));
vi.mock("@/lib/coach/memory", async (orig) => ({
  ...(await orig()) as object,
  persistMemory: persistMemoryMock,
}));

import { _setDepsForTest } from "@/lib/zerog/storage";

const VALID_EXPORT = JSON.stringify({
  date_range: { days: 1, start: "2026-07-20T00:00:00Z", end: "2026-07-20T23:59:59Z" },
  export_date: "2026-07-21T08:00:00Z",
  metrics: [
    {
      id: "HKQuantityTypeIdentifierRestingHeartRate",
      data_points: [{ value: 50, start_date: "2026-07-20T06:00:00Z", end_date: "2026-07-20T06:00:00Z" }],
    },
  ],
  category_metrics: [],
  workouts: [],
});

const V1_RUN = {
  distanceKm: 5, durationSec: 1500, avgPaceSecKm: 300, elevationGainM: 40,
  splitsSecKm: [300, 298, 302, 301, 299], avgHr: 150, startedAt: "2026-07-20T07:30:00.000Z", reportHeadline: "",
  gpxRoot: "0xfixturegpxroot", gpxContentHash: "0x" + "ab".repeat(32), report: null, feelings: null,
};

function req(fileContent: string | null, opts?: { fileName?: string; userKeyHex?: string | null; fileSize?: number }) {
  const form = new FormData();
  if (fileContent !== null) {
    const bytes = opts?.fileSize != null ? new Uint8Array(opts.fileSize) : new TextEncoder().encode(fileContent);
    form.set("file", new File([bytes], opts?.fileName ?? "export.json", { type: "application/json" }));
  }
  if (opts?.userKeyHex !== null) form.set("userKeyHex", opts?.userKeyHex ?? "aa".repeat(32));
  return new Request("http://x/api/health-data", { method: "POST", headers: { authorization: "Bearer t" }, body: form });
}

describe("POST /api/health-data", () => {
  beforeEach(() => {
    dbUpdates.length = 0;
    persistMemoryMock.mockClear();
    decryptJsonMock.mockClear();
    decryptedMemoryToReturn = {
      version: 2, coach: { name: "K", personality: "coach" }, privateLayer: { runs: [], healthSnapshot: null },
    };
    coachRow = {
      id: 1, userId: 1, tokenId: "1", name: "K", personality: "coach",
      memoryRoot: "0xm", profileRoot: "0xp", mintTx: "0xmint",
      memoryCipher: "cached-cipher-envelope",
      healthRoot: null, healthWindowDays: null, healthFrom: null, healthTo: null, healthMetrics: null,
      healthExportedAt: null, healthUploadedAt: null,
    };
    // Root hash is computed locally (fast, no network) by the real
    // prepareEncryptedUpload — doUpload below stands in for the slow/
    // sometimes-hanging network call it makes in the background.
    _setDepsForTest({
      makeData: async () => ({ data: {}, rootHash: "0xhealthroot" }),
      doUpload: async () => ["0xstoragetx", null] as const,
      doDownload: async () => { throw new Error("doDownload must not be called when coaches.memoryCipher is cached"); },
    });
  });

  it("export valido → snapshot scritto in memoria (persistMemory), coverage salvata su Postgres, mai valori", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(VALID_EXPORT));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.coverage).toMatchObject({ windowDays: 1, from: "2026-07-20", to: "2026-07-20", metrics: ["restingHr"] });

    expect(persistMemoryMock).toHaveBeenCalledTimes(1);
    const [updatedMemory] = persistMemoryMock.mock.calls[0];
    expect(updatedMemory.privateLayer.healthSnapshot).toMatchObject({ windowDays: 1 });
    expect(updatedMemory.privateLayer.healthSnapshot.days[0]).toMatchObject({ date: "2026-07-20", restingHr: 50 });

    const coachUpdate = dbUpdates.find((u) => u.memoryCipher);
    expect(coachUpdate).toMatchObject({
      memoryRoot: "0xnewmem", profileRoot: "0xnewprof", memoryCipher: "fresh-cipher-envelope",
      healthRoot: "0xhealthroot", healthWindowDays: 1, healthFrom: "2026-07-20", healthTo: "2026-07-20",
      healthMetrics: ["restingHr"],
    });
    // Postgres never gets a health VALUE — only coverage metadata (window,
    // metric names, dates). The literal resting-HR value (50) from the
    // fixture above must never appear in what got written to the DB.
    expect(JSON.stringify(coachUpdate)).not.toContain('"restingHr":50');
  });

  it("l'upload raw cifrato su 0G parte in background e NON viene atteso dalla risposta HTTP", async () => {
    let resolveDoUpload: (v: readonly [string | null, Error | null]) => void = () => {};
    const doUploadPromise = new Promise<readonly [string | null, Error | null]>((resolve) => { resolveDoUpload = resolve; });
    const doUploadMock = vi.fn(() => doUploadPromise);
    _setDepsForTest({
      makeData: async () => ({ data: {}, rootHash: "0xhealthroot" }),
      doUpload: doUploadMock,
      doDownload: async () => { throw new Error("must not be called"); },
    });

    const { POST } = await import("./route");
    // If the route awaited the raw-export upload, this would hang forever
    // (doUploadPromise never resolves) and the test would time out instead
    // of completing — the response resolving here IS the proof.
    const res = await POST(req(VALID_EXPORT));
    expect(res.status).toBe(200);
    expect(doUploadMock).toHaveBeenCalledTimes(1); // fired…
    // …but never awaited: doUploadPromise is still pending at this point.

    // Clean up so nothing lingers past this test.
    resolveDoUpload(["0xstoragetx", null] as const);
    await new Promise((r) => setTimeout(r, 0));
  });

  it("memoria v1 (senza healthSnapshot) → migrata a v2 e il nuovo snapshot viene scritto, le corse esistenti sopravvivono", async () => {
    decryptedMemoryToReturn = { version: 1, coach: { name: "K", personality: "coach" }, privateLayer: { runs: [V1_RUN] } };
    const { POST } = await import("./route");
    const res = await POST(req(VALID_EXPORT));
    expect(res.status).toBe(200);

    const [updatedMemory] = persistMemoryMock.mock.calls[0];
    expect(updatedMemory.version).toBe(2);
    expect(updatedMemory.privateLayer.runs).toHaveLength(1); // preserved from v1
    expect(updatedMemory.privateLayer.healthSnapshot.days[0]).toMatchObject({ restingHr: 50 });
  });

  it("file non JSON / non riconosciuto come export → 400 che nomina l'app attesa, persistMemory mai chiamata", async () => {
    const { POST } = await import("./route");
    const res = await POST(req("this is not json at all"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Health Data Export");
    expect(persistMemoryMock).not.toHaveBeenCalled();
  });

  it("JSON valido ma senza forma di export sanitario → 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(JSON.stringify({ hello: "world" })));
    expect(res.status).toBe(400);
    expect(persistMemoryMock).not.toHaveBeenCalled();
  });

  it("file oltre ~30MB → 400, mai letto/parsato", async () => {
    const { POST } = await import("./route");
    const res = await POST(req("ignored", { fileSize: 30 * 1024 * 1024 + 1 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.toLowerCase()).toContain("30mb");
    expect(persistMemoryMock).not.toHaveBeenCalled();
  });

  it("file mancante → 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(null));
    expect(res.status).toBe(400);
  });

  it("userKeyHex non esadecimale → 400", async () => {
    const { POST } = await import("./route");
    const res = await POST(req(VALID_EXPORT, { userKeyHex: "zz".repeat(32) }));
    expect(res.status).toBe(400);
  });

  it("coach inesistente → 404", async () => {
    coachRow = null;
    const { POST } = await import("./route");
    const res = await POST(req(VALID_EXPORT));
    expect(res.status).toBe(404);
  });

  it("coach non ancora mintato (tokenId vuoto) → 409", async () => {
    coachRow.tokenId = "";
    const { POST } = await import("./route");
    const res = await POST(req(VALID_EXPORT));
    expect(res.status).toBe(409);
  });

  it("memoryCipher assente → fallback sul reale downloadDecrypted (percorso re-sync)", async () => {
    coachRow.memoryCipher = null;
    _setDepsForTest({
      makeData: async () => ({ data: {}, rootHash: "0xhealthroot" }),
      doUpload: async () => ["0xstoragetx", null] as const,
      doDownload: async () => Buffer.from(JSON.stringify({})),
    });
    const { POST } = await import("./route");
    const res = await POST(req(VALID_EXPORT));
    expect(res.status).toBe(200);
  });

  it("senza token di auth → 401", async () => {
    const auth = await import("@/lib/auth");
    (auth.requireUser as any).mockRejectedValueOnce(Object.assign(new Error("missing token"), { status: 401 }));
    const { POST } = await import("./route");
    const res = await POST(req(VALID_EXPORT));
    expect(res.status).toBe(401);
  });
});
