import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => ({ userId: 1, wallet: "0x" + "22".repeat(20), privyDid: "did:x" })),
}));

const USER_KEY_HEX = "aa".repeat(32);
const GPX_ROOT = "0xgpxroot";
const OLD_MEMORY_ROOT = "0xoldmem";

const state: {
  runRows: any[];
  coachRows: any[];
  deleted: { table: string; id: number | null; userId: number | null }[];
  coachPatches: any[];
  commitWins: boolean;
} = { runRows: [], coachRows: [], deleted: [], coachPatches: [], commitWins: true };

/**
 * A db fake that READS its `where` predicates.
 *
 * The previous one ignored them, so neither the ownership scoping on the run
 * read nor the predicate on the destructive delete was ever exercised: dropping
 * `eq(runs.id, runId)` — which would wipe every run the athlete owns — left all
 * seven tests green. These helpers pull the column/value pairs back out of the
 * drizzle condition so the tests can assert what the query actually asked for.
 */
function flatten(cond: any, out: any[] = []): any[] {
  for (const chunk of cond?.queryChunks ?? []) {
    if (Array.isArray(chunk?.queryChunks)) flatten(chunk, out);
    // A column carries a name; a Param carries a scalar value (a StringChunk's
    // `value` is an ARRAY of SQL fragments, which is why naive "has a value"
    // matching picked the wrong chunk and every row looked unmatched).
    else if (chunk?.name) out.push({ column: chunk.name });
    else if (chunk && typeof chunk === "object" && "value" in chunk && !Array.isArray(chunk.value)) {
      out.push({ param: chunk.value });
    }
  }
  return out;
}
function conditions(cond: any): { column: string; value: unknown }[] {
  const flat = flatten(cond);
  const pairs: { column: string; value: unknown }[] = [];
  for (let i = 0; i < flat.length; i++) {
    if (flat[i].column && flat[i + 1] && "param" in flat[i + 1]) {
      pairs.push({ column: flat[i].column, value: flat[i + 1].param });
    }
  }
  return pairs;
}
const valueOf = (cond: any, column: string) => {
  const hit = conditions(cond).find((c) => c.column === column);
  return hit ? hit.value : null;
};

function matches(row: any, cond: any): boolean {
  const id = valueOf(cond, "id");
  const userId = valueOf(cond, "user_id");
  if (id !== null && row.id !== id) return false;
  if (userId !== null && row.userId !== userId) return false;
  return true;
}

vi.mock("@/db", async () => {
  const schema = await import("@/db/schema");
  return {
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: async (cond: any) =>
            (table === schema.coaches ? state.coachRows : state.runRows).filter((r) => matches(r, cond)),
        }),
      }),
      update: () => ({
        set: (patch: any) => ({
          where: (cond: any) => {
            const rows = state.commitWins ? [{ id: 1 }] : [];
            if (rows.length) {
              state.coachPatches.push(patch);
              // The compare-and-swap guard: the UPDATE only matches while
              // memory_root still holds the root the caller read.
              expect(valueOf(cond, "memory_root")).toBe(OLD_MEMORY_ROOT);
            }
            const p: any = Promise.resolve(rows);
            p.returning = async () => rows;
            return p;
          },
        }),
      }),
      delete: (table: unknown) => ({
        where: async (cond: any) => {
          state.deleted.push({
            table: table === schema.runs ? "runs" : "other",
            id: valueOf(cond, "id") as number | null,
            userId: valueOf(cond, "user_id") as number | null,
          });
        },
      }),
    },
  };
});

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
const params = (id = "7") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  const { memory } = initialMemory("K", "coach", "trail ultras");
  state.runRows = [{ id: 7, userId: 1, status: "done", gpxRoot: GPX_ROOT, createdAt: new Date() }];
  state.coachRows = [
    {
      id: 1, userId: 1, tokenId: "3", name: "K", personality: "coach",
      memoryRoot: OLD_MEMORY_ROOT, profileRoot: "0xoldprof", mintTx: "0xmint",
      memoryCipher: encryptJson(appendRun(memory, runSummary), Buffer.from(USER_KEY_HEX, "hex")),
    },
  ];
  state.deleted = [];
  state.coachPatches = [];
  state.commitWins = true;
  prepareMemoryCommitMock.mockClear();
  uploadMock.mockClear();
  updateRegistryMock.mockReset().mockResolvedValue("0xanchor");
});

describe("DELETE /api/runs/[id]", () => {
  it("toglie la corsa dalla memoria, riscrive entrambe le cache, poi cancella la riga", async () => {
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), params());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ deleted: true, memoryUpdated: true, registryTx: "0xanchor", anchored: true });

    const persisted = prepareMemoryCommitMock.mock.calls[0][0] as any;
    expect(persisted.privateLayer.runs).toHaveLength(0);
    expect(persisted.coach.expertise).toBe("trail ultras"); // il brief non si tocca
    // profileCipher insieme a memoryCipher: è la copia che legge un estraneo.
    expect(state.coachPatches[0]).toMatchObject({
      memoryCipher: "fresh-memory-envelope",
      profileCipher: "fresh-profile-envelope",
    });
    // L'upload su 0G parte DOPO la risposta, non dentro la richiesta.
    expect(uploadMock).toHaveBeenCalled();
  });

  it("cancella esattamente quella corsa, e solo se è dell'utente", async () => {
    const { DELETE } = await import("./route");
    await DELETE(req(), params());
    expect(state.deleted).toEqual([{ table: "runs", id: 7, userId: 1 }]);
  });

  it("la corsa di un altro utente è 404: la query filtra per proprietario", async () => {
    // Riga presente ma di qualcun altro: senza il filtro per userId questo test
    // passerebbe cancellando roba altrui.
    state.runRows = [{ id: 7, userId: 999, status: "done", gpxRoot: GPX_ROOT }];
    const { DELETE } = await import("./route");
    expect((await DELETE(req(), params())).status).toBe(404);
    expect(state.deleted).toHaveLength(0);
  });

  it("una corsa ancora in elaborazione NON si cancella: la pipeline la riscriverebbe dentro", async () => {
    state.runRows = [{ id: 7, userId: 1, status: "processing", gpxRoot: null, createdAt: new Date() }];
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), params());
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("run_processing");
    expect(state.deleted).toHaveLength(0);
  });

  it("una corsa 'processing' da troppo tempo NON è più viva: si può cancellare", async () => {
    // La pipeline vive nel processo del server: un riavvio la uccide e la riga
    // resta 'processing' per sempre. Rifiutare anche quella sarebbe una trappola.
    state.runRows = [
      { id: 7, userId: 1, status: "processing", gpxRoot: null, createdAt: new Date(Date.now() - 30 * 60_000) },
    ];
    const { DELETE } = await import("./route");
    expect((await DELETE(req(), params())).status).toBe(200);
    expect(state.deleted).toHaveLength(1);
  });

  it("se qualcun altro ha riscritto la memoria nel frattempo → 409, niente cancellato", async () => {
    state.commitWins = false;
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), params());
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("memory_conflict");
    expect(state.deleted).toHaveLength(0);
  });

  it("una corsa che NON è nella memoria si cancella senza riscriverla né ancorare", async () => {
    // gpxRoot presente (store_gpx era andato) ma update_memory era fallito: la
    // riscrittura sarebbe un no-op che costa un upload e una tx.
    state.runRows = [{ id: 7, userId: 1, status: "error", gpxRoot: "0xaltro-root" }];
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), params());
    expect(res.status).toBe(200);
    expect((await res.json()).memoryUpdated).toBe(false);
    expect(prepareMemoryCommitMock).not.toHaveBeenCalled();
    expect(updateRegistryMock).not.toHaveBeenCalled();
    expect(state.deleted).toHaveLength(1);
  });

  it("mint non confermato: nessun tentativo di leggere una memoria che non esiste", async () => {
    state.coachRows = [{ ...state.coachRows[0], tokenId: "", memoryRoot: "", memoryCipher: null }];
    state.runRows = [{ id: 7, userId: 1, status: "error", gpxRoot: GPX_ROOT }];
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), params());
    expect(res.status).toBe(200);
    expect(prepareMemoryCommitMock).not.toHaveBeenCalled();
    expect(state.deleted).toHaveLength(1);
  });

  it("dichiara la copia su 0G Storage SOLO se qualcosa era stato davvero caricato", async () => {
    const { DELETE } = await import("./route");
    const withGpx = await (await DELETE(req(), params())).json();
    expect(withGpx.note).toMatch(/0G Storage/);

    state.runRows = [{ id: 7, userId: 1, status: "error", gpxRoot: null }];
    state.deleted = [];
    const withoutGpx = await (await DELETE(req(), params())).json();
    expect(withoutGpx.note).toMatch(/non resta alcuna copia/);
  });

  it("l'ancoraggio fallito non blocca la cancellazione, ma viene DETTO", async () => {
    updateRegistryMock.mockRejectedValueOnce(new Error("galileo rpc down"));
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.anchored).toBe(false);
    expect(body.anchorError).toMatch(/galileo rpc down/);
    expect(state.deleted).toHaveLength(1);
  });

  it("chiave sbagliata → 400 leggibile, non un 500 con le interiora di node", async () => {
    state.coachRows = [{ ...state.coachRows[0], memoryCipher: encryptJson({ v: 1 }, Buffer.from("bb".repeat(32), "hex")) }];
    const { DELETE } = await import("./route");
    const res = await DELETE(req(), params());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/chiave errata/);
    expect(state.deleted).toHaveLength(0);
  });

  it("id malformato → 400: '1e3' non deve diventare la corsa 1000", async () => {
    const { DELETE } = await import("./route");
    for (const id of ["1e3", "0x11", " 7", "9999999999", "abc"]) {
      expect((await DELETE(req(), params(id))).status).toBe(400);
    }
    expect(state.deleted).toHaveLength(0);
  });

  it("senza userKeyHex valido → 400, niente cancellato", async () => {
    const { DELETE } = await import("./route");
    expect((await DELETE(req({ userKeyHex: "nope" }), params())).status).toBe(400);
    expect(state.deleted).toHaveLength(0);
  });
});
