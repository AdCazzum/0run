import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { coaches } from "@/db/schema";
import { decryptJson } from "@/lib/crypto/aes";
import { downloadDecrypted, prepareEncryptedUpload } from "@/lib/zerog/storage";
import { parseMemory, persistMemory, setHealthSnapshot } from "@/lib/coach/memory";
import { toBytes32, updateRegistry } from "@/lib/zerog/contracts";
import { parseHealthExport, HealthParseError } from "@/lib/health/parse";

// The real export used for the demo is 11 MB (docs/superpowers/specs/
// 2026-07-25-health-data-spec.md §2) — cap generously above that instead of
// exactly at it, so a slightly bigger real export doesn't fail on principle.
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024; // ~30MB

// The iOS app Ivan's demo (and the README) tells users to install and export
// from — cited by name here so a 400 tells the user exactly what to go get,
// not just "bad file" (docs/superpowers/specs/2026-07-25-health-data-spec.md,
// "Decisioni prese").
const EXPORT_APP_NAME = "Health Data Export";

/**
 * POST /api/health-data (multipart: `file` + `userKeyHex`) — uploads an
 * Apple Health JSON export (from the "Health Data Export" iOS app, NOT
 * Apple's native export.xml). Parses it with parseHealthExport (proven
 * against a real 11 MB export — see apps/web/src/lib/health/parse.ts), then:
 *
 *   (a) fires the RAW export, encrypted with the athlete's own key, at 0G
 *       Storage in the background — NEVER awaited by this response. Measured
 *       reality (docs/0g-reality-check.md): uploads can take minutes and have
 *       hung for 20+ with no internal SDK timeout, so awaiting it here would
 *       make every health upload look broken.
 *   (b) writes the compact ~2KB snapshot into the encrypted memory (private
 *       layer only — see the privacy-invariant tests in coach.test.ts) and
 *       persists both layers, refreshing coaches.memoryCipher exactly like
 *       the run pipeline does, for the same reason: a freshly uploaded blob
 *       is not reliably downloadable from 0G Storage for 16+ minutes, so the
 *       next hot-path read (a chat message, a run report) must not depend on
 *       reading it back from Storage.
 *
 * Postgres only ever gets coverage metadata (window, metric names) on the
 * `coaches` row — never a health value. The values live only in the
 * user-key-encrypted memory and, raw, on 0G Storage.
 */
export async function POST(req: Request) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser(req);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid multipart body" }, { status: 400 });
  }

  const file = form.get("file");
  const keyHex = form.get("userKeyHex");
  // Same shape as every other route's userKeyHex validation: Buffer.from(hex,
  // "hex") silently ignores invalid characters instead of throwing, so a
  // plain length check would let non-hex garbage through and derive a wrong
  // AES key instead of failing loudly.
  if (!(file instanceof File) || typeof keyHex !== "string" || !/^[0-9a-f]{64}$/i.test(keyHex)) {
    return NextResponse.json(
      { error: "file e userKeyHex richiesti (userKeyHex: 64 caratteri esadecimali)" },
      { status: 400 },
    );
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `file troppo grande (${(file.size / 1024 / 1024).toFixed(1)}MB) — massimo ~30MB. ` +
          `Esporta di nuovo dall'app "${EXPORT_APP_NAME}" con una finestra più corta se il file reale supera questo limite.`,
      },
      { status: 400 },
    );
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    return NextResponse.json({ error: "impossibile leggere il file" }, { status: 400 });
  }

  let parsed: ReturnType<typeof parseHealthExport>;
  try {
    parsed = parseHealthExport(text);
  } catch (e) {
    if (e instanceof HealthParseError) {
      return NextResponse.json(
        {
          error: `file non riconosciuto come export sanitario — esporta i tuoi dati in JSON dall'app "${EXPORT_APP_NAME}" e ricarica quel file`,
        },
        { status: 400 },
      );
    }
    throw e;
  }
  const { snapshot, coverage } = parsed;

  const userKey = Buffer.from(keyHex, "hex");

  try {
    const [coach] = await db.select().from(coaches).where(eq(coaches.userId, user.userId));
    if (!coach) return NextResponse.json({ error: "coach non trovato" }, { status: 404 });
    // An empty tokenId means the row is only a mint reservation (see the
    // mint route) — same guard as the run pipeline.
    if (!coach.tokenId) {
      return NextResponse.json(
        { error: "coach non ancora mintato: completa il mint prima di caricare dati sanitari" },
        { status: 409 },
      );
    }

    // AMENDMENT 1 (docs/0g-reality-check.md), same pattern as pipeline.ts/
    // the chat route: a freshly uploaded blob is not reliably downloadable
    // from 0G Storage for 16+ minutes, so this hot path reads the cached
    // ciphertext from Postgres first and only falls back to Storage for rows
    // that predate the cache column.
    let memoryCipherText: string;
    if (coach.memoryCipher) {
      memoryCipherText = coach.memoryCipher;
    } else {
      const dl = await downloadDecrypted(coach.memoryRoot, userKey, (buf) => {
        try { JSON.parse(buf.toString("utf8")); return true; } catch { return false; }
      });
      if (!dl.ok) return NextResponse.json({ error: dl.error }, { status: 502 });
      memoryCipherText = dl.data.toString("utf8");
    }

    let memory;
    try {
      // parseMemory (not decryptJson(..., CoachMemorySchema) directly): real
      // memories already on 0G Storage may still be v1 (pre-healthSnapshot).
      memory = parseMemory(decryptJson(memoryCipherText, userKey, z.unknown()));
    } catch {
      // Wrong key and a corrupted/foreign ciphertext both throw here
      // (AES-GCM auth tag mismatch or schema mismatch) — deliberately the
      // same generic failure either way, same discipline as the feelings
      // route.
      return NextResponse.json({ error: "impossibile decifrare la memoria (chiave errata?)" }, { status: 400 });
    }

    // Last export wins — no merge of overlapping windows (see setHealthSnapshot).
    const updated = setHealthSnapshot(memory, snapshot);

    const receipts = await persistMemory(updated, userKey);
    if (!receipts.memory.ok || !receipts.profile.ok) {
      return NextResponse.json({ error: "persist della memoria fallita" }, { status: 502 });
    }

    // Raw export, encrypted with the athlete's OWN key, to 0G Storage —
    // fire-and-forget, NEVER awaited by this response (see doc comment
    // above). prepareEncryptedUpload splits the LOCAL, fast, pure
    // merkle-tree computation (no network) from the slow/sometimes-hanging
    // network upload, so a real rootHash commitment is available to persist
    // immediately, same pattern as the mint route's background uploads.
    let healthRoot: string | null = null;
    try {
      const rawBytes = new TextEncoder().encode(text);
      const prep = await prepareEncryptedUpload(rawBytes, userKey);
      healthRoot = prep.rootHash;
      prep.upload()
        .then((r) => {
          if (!r.ok) console.error("health-data: background raw export upload failed", r.error);
          else console.log("health-data: background raw export upload ok", r.txHash);
        })
        .catch((e) => console.error("health-data: background raw export upload crashed", e));
    } catch (e) {
      // Local merkle-tree prep failed (rare) — the snapshot already lives
      // safely in the memory persisted above, so this is a logged,
      // non-fatal degradation (the spec's declared fallback: snapshot-only
      // is an accepted, honest cut), never a request failure.
      console.error("health-data: raw export upload prepare failed", e);
    }

    // The memory changed, so the on-chain anchor must change with it: the whole
    // claim is that the hash of the coach's memory is verifiable on-chain, and an
    // anchor left pointing at the pre-health memory would quietly make that claim
    // false until the next run happened to update it. Not fatal if it fails — the
    // memory is already persisted and the next run re-anchors — but never silent.
    let registryTx: string | null = null;
    try {
      registryTx = await updateRegistry(
        coach.tokenId,
        toBytes32(receipts.memory.rootHash),
        toBytes32(receipts.profile.rootHash),
      );
    } catch (e) {
      console.error("health-data: on-chain memory anchor failed, will re-anchor on the next run", e);
    }

    await db.update(coaches).set({
      memoryRoot: receipts.memory.rootHash,
      profileRoot: receipts.profile.rootHash,
      memoryCipher: receipts.memoryCipher,
      healthRoot: healthRoot ?? coach.healthRoot,
      healthWindowDays: coverage.days,
      healthFrom: coverage.from || null,
      healthTo: coverage.to || null,
      healthMetrics: coverage.metrics,
      healthExportedAt: snapshot.exportedAt || null,
      healthUploadedAt: new Date(),
    }).where(eq(coaches.id, coach.id));

    return NextResponse.json({
      coverage: { windowDays: coverage.days, from: coverage.from || null, to: coverage.to || null, metrics: coverage.metrics },
      registryTx,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
