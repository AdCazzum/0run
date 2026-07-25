import { ethers } from "ethers";
import { z } from "zod";
import { db } from "@/db";
import { coaches, runs, type RunStep, type StepState } from "@/db/schema";
import { eq } from "drizzle-orm";
import { parseGpx } from "../gpx/parse";
import { decryptJson, encryptJson, canDecrypt } from "../crypto/aes";
import { downloadDecrypted, uploadEncrypted } from "../zerog/storage";
import { toBytes32, updateRegistry } from "../zerog/contracts";
import { completeJson } from "../inference";
import { appendRun, buildProfile, parseMemory, persistMemory } from "./memory";
import { commitMemory } from "./commit";
import { buildReportMessages, ReportSchema } from "./prompts";
import { scoreRun } from "./score";

const ALL_STEPS: RunStep[] = ["encrypt", "store_gpx", "update_memory", "registry_tx", "score", "inference"];
export const initialSteps = (): Record<RunStep, StepState> =>
  Object.fromEntries(ALL_STEPS.map((s) => [s, { status: "pending" }])) as Record<RunStep, StepState>;

/**
 * Runs the whole upload pipeline for one GPX and mutates `runs` row `runId`
 * step-by-step so the UI can poll it. Never throws unhandled — every
 * failure mode ends in `status: "error"` on the row with a human-readable
 * detail on the step that failed.
 */
export async function processRun(
  runId: number, userId: number, gpxXml: string, userKey: Buffer,
  // Free-text "how did it feel", already trimmed/length-checked by the
  // upload route (empty → null there, so this is never an empty string
  // here). Optional/defaulted so every existing call site (and every run
  // that doesn't submit feelings) behaves exactly as before this feature.
  feelings: string | null = null,
): Promise<void> {
  const steps = initialSteps();
  const mark = async (step: RunStep, state: StepState, extra: Partial<typeof runs.$inferInsert> = {}) => {
    steps[step] = state;
    await db.update(runs).set({ steps: { ...steps }, ...extra }).where(eq(runs.id, runId));
  };
  const fail = async (step: RunStep, detail: string) => {
    steps[step] = { status: "error", detail };
    await db.update(runs).set({ steps: { ...steps }, status: "error" }).where(eq(runs.id, runId));
  };

  // Tracks which stage we're in so the catch block below can attribute an
  // unexpected throw (parse error, wrong decryption key, inference schema
  // failure, a rejected on-chain tx...) to the right step instead of
  // guessing — every stage that can throw sets this right before it runs.
  let currentStep: RunStep = "encrypt";

  try {
    // 1. parse + "encrypt" (actual encryption happens inside uploadEncrypted;
    // this step represents it in the UI) + content hash for the manifest.
    currentStep = "encrypt";
    const { stats, polyline } = parseGpx(gpxXml);
    const gpxContentHash = ethers.keccak256(ethers.toUtf8Bytes(gpxXml));
    // Same AES-256-GCM envelope format as coaches.memoryCipher, keyed by the
    // athlete's own userKey — Postgres never sees the plaintext feelings.
    // Computed here (not gated on later steps succeeding) so it survives on
    // the row the same way stats/polyline do even if a later step fails.
    const feelingsCipher = feelings != null ? encryptJson(feelings, userKey) : null;
    await mark("encrypt", { status: "done" }, { stats, polyline, feelingsCipher });

    // 2. encrypted GPX to storage
    currentStep = "store_gpx";
    const gpxReceipt = await uploadEncrypted(new TextEncoder().encode(gpxXml), userKey);
    if (!gpxReceipt.ok) return fail("store_gpx", gpxReceipt.error);
    await mark("store_gpx", { status: "done", detail: gpxReceipt.rootHash }, { gpxRoot: gpxReceipt.rootHash });

    // 3. memory: read (cache-first) -> decrypt -> append -> re-persist
    currentStep = "update_memory";
    const [coach] = await db.select().from(coaches).where(eq(coaches.userId, userId));
    if (!coach) return fail("update_memory", "coach non trovato");
    // An empty tokenId means the row is only a mint reservation (see the mint route):
    // proceeding would try to read an empty memoryRoot and fail with a confusing
    // storage error instead of naming the real cause.
    if (!coach.tokenId) return fail("update_memory", "coach non ancora mintato: completa il mint prima di caricare una corsa");

    // AMENDMENT 1 (docs/0g-reality-check.md, measured 2026-07-25): a freshly
    // uploaded blob is not reliably downloadable from 0G Storage for 16+
    // minutes. Reading the coach's memory back from Storage on this hot path
    // would fail on every user's FIRST run right after minting (that blob
    // was uploaded seconds earlier). coaches.memoryCipher caches the same
    // AES envelope encryptJson(memory, userKey) produces — ciphertext only —
    // so the pipeline decrypts from there directly. Storage stays the
    // durable, on-chain-anchored source of truth; the DB is a rebuildable
    // cache of it. Only fall back to downloadDecrypted when the cache is
    // empty (rows minted before this column existed, or a future re-sync
    // path) — by then the blob is old and finalized, so the download is safe.
    let memoryCipherText: string;
    if (coach.memoryCipher) {
      memoryCipherText = coach.memoryCipher;
    } else {
      const memDl = await downloadDecrypted(coach.memoryRoot, userKey, (b) => canDecrypt(b.toString("utf8"), userKey));
      if (!memDl.ok) return fail("update_memory", memDl.error);
      memoryCipherText = memDl.data.toString("utf8");
    }
    // parseMemory (not decryptJson(..., CoachMemorySchema) directly): real
    // memories already on 0G Storage may still be v1 (pre-healthSnapshot) —
    // see apps/web/src/lib/coach/memory.ts for the migration.
    const memory = parseMemory(decryptJson(memoryCipherText, userKey, z.unknown()));

    // AMENDMENT 2 (SSOT): the manifest fields land on the RunSummary right
    // here, when it's appended. `report` is null: inference (step 5) runs
    // after this append+persist because it needs the updated memory/profile
    // to build its prompt, so the report for THIS run is not known yet at
    // manifest-write time. Documented, accepted gap — not backfilled here.
    const updated = appendRun(memory, {
      ...stats, reportHeadline: "", gpxRoot: gpxReceipt.rootHash, gpxContentHash, report: null,
      feelings,
    });
    const receipts = await persistMemory(updated, userKey);
    if (!receipts.memory.ok || !receipts.profile.ok) return fail("update_memory", "persist fallita");
    // Compare-and-swap on the root we started from: a brief edit or a run
    // deletion can land while this upload is in flight, and a blind write would
    // silently throw their change away (or theirs would throw this run away).
    // Losing the race here is not fatal — the run's own row is intact and the
    // step says why — but it must never pass for success.
    const committed = await commitMemory(coach.userId, coach.memoryRoot, {
      memoryRoot: receipts.memory.rootHash,
      profileRoot: receipts.profile.rootHash,
      memoryCipher: receipts.memoryCipher,
      profileCipher: receipts.profileCipher,
    });
    if (!committed) {
      return fail("update_memory", "la memoria del coach è cambiata durante l'elaborazione (altra modifica in corso): ricarica la corsa e riprova");
    }
    await mark("update_memory", { status: "done", detail: receipts.memory.rootHash });

    // 4. hash on-chain
    currentStep = "registry_tx";
    const regTx = await updateRegistry(
      coach.tokenId,
      toBytes32(receipts.memory.rootHash),
      toBytes32(receipts.profile.rootHash),
    );
    await mark("registry_tx", { status: "done", detail: regTx }, { registryTx: regTx });

    // 5. attested effort score, on the TEE-verified 0G Compute "direct" path
    // (see ./score.ts and docs/0g-reality-check.md, "Router contro Direct").
    // Runs BEFORE inference so a successful score can be cited by the
    // narrative report below. This step must NEVER fail the run: scoreRun
    // itself never throws, but the step is still wrapped defensively and,
    // on failure, is marked "error" with a detail while the pipeline moves
    // on to inference regardless — the report is the product, the score is
    // an enhancement.
    currentStep = "score";
    const profile = buildProfile(updated);
    const scoreOutcome = await scoreRun(profile, memory.privateLayer.runs, stats);
    if (scoreOutcome.ok) {
      await mark("score", { status: "done", detail: `${scoreOutcome.score}/5` }, {
        effortScore: scoreOutcome.score,
        scoreNote: scoreOutcome.note,
        scoreVerified: scoreOutcome.verified === null ? "unavailable" : String(scoreOutcome.verified),
      });
    } else {
      await mark("score", { status: "error", detail: scoreOutcome.error });
    }

    // 6. inference (narrative report, router path)
    currentStep = "inference";
    const { value: report, meta } = await completeJson(
      ReportSchema,
      buildReportMessages(
        profile, memory.privateLayer.runs, stats, feelings,
        scoreOutcome.ok ? { score: scoreOutcome.score, verified: scoreOutcome.verified } : null,
        // Decrypted private-layer health snapshot, if the athlete has
        // uploaded one (see /api/health-data) — never sourced from the
        // public profile, so this can only ever populate on the owner's own
        // decrypt path (this pipeline), never on the letting path.
        memory.privateLayer.healthSnapshot,
      ),
    );
    await mark("inference", { status: "done" }, {
      report, model: meta.model,
      verifiedTee: meta.verified === null ? "unavailable" : String(meta.verified),
      status: "done",
    });
  } catch (e: any) {
    await fail(currentStep, String(e?.message ?? e));
  }
}
