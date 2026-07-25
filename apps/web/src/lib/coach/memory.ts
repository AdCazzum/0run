import {
  CoachMemory, CoachMemorySchema, CoachMemoryV1Schema, CoachProfile, CoachProfileSchema, HealthSnapshot,
  RunSummary, StorageReceipt, PERSONALITY_STYLE,
} from "@0run/shared";
import { encryptJson } from "../crypto/aes";
import { serviceKey } from "../crypto/keys";
import { uploadEncrypted } from "../zerog/storage";

/**
 * Reads a decrypted memory payload of unknown shape and returns a valid v2
 * CoachMemory, migrating v1 memories in place. Real encrypted memories
 * already on 0G Storage were written as v1 (no `healthSnapshot`); this is
 * the ONLY place that bridges the two shapes, so every reader (pipeline,
 * chat, health-data upload) goes through it instead of parsing against
 * CoachMemorySchema directly. Tries v2 first (the common case once a memory
 * has been re-persisted at least once — see persistMemory below, which
 * always writes v2), falls back to the frozen CoachMemoryV1Schema, and
 * migrates by adding `healthSnapshot: null` (a v1 memory has never seen
 * health data by definition). Throws if neither shape matches — an honest
 * failure, not a silent coercion.
 */
export function parseMemory(json: unknown): CoachMemory {
  const v2 = CoachMemorySchema.safeParse(json);
  if (v2.success) return v2.data;
  const v1 = CoachMemoryV1Schema.parse(json);
  return CoachMemorySchema.parse({
    ...v1,
    version: 2,
    privateLayer: { ...v1.privateLayer, healthSnapshot: null },
  });
}

export function appendRun(memory: CoachMemory, run: RunSummary): CoachMemory {
  return CoachMemorySchema.parse({
    ...memory,
    // Preserve healthSnapshot across the append — without spreading
    // memory.privateLayer here, every run upload would silently wipe out a
    // previously uploaded health snapshot (appendRun only ever intends to
    // add a run, never to touch health data).
    privateLayer: { ...memory.privateLayer, runs: [...memory.privateLayer.runs, run] },
  });
}

/**
 * Replaces the private-layer health snapshot wholesale (last export wins —
 * see docs/superpowers/specs/2026-07-25-health-data-spec.md §5: no merging
 * of overlapping windows across uploads). Pure, mirrors appendRun.
 */
export function setHealthSnapshot(memory: CoachMemory, healthSnapshot: HealthSnapshot): CoachMemory {
  return CoachMemorySchema.parse({
    ...memory,
    privateLayer: { ...memory.privateLayer, healthSnapshot },
  });
}

export function buildProfile(memory: CoachMemory): CoachProfile {
  const runs = memory.privateLayer.runs;
  return CoachProfileSchema.parse({
    version: 1,
    name: memory.coach.name,
    personality: memory.coach.personality,
    totals: { runs: runs.length, km: Math.round(runs.reduce((a, r) => a + r.distanceKm, 0) * 100) / 100 },
    paceTrend: runs.slice(-10).map((r) => r.avgPaceSecKm),
    styleNotes: PERSONALITY_STYLE[memory.coach.personality],
  });
}

/**
 * Cifra e carica entrambi gli strati. NB: il testo cifrato va dentro un envelope JSON in bytes.
 *
 * Ritorna anche `memoryCipher`, l'envelope AES della memoria (stesso output di
 * encryptJson(memory, userKey)) così i chiamanti possono metterlo in cache
 * (coaches.memoryCipher) senza ri-cifrare — ri-cifrare produrrebbe un
 * ciphertext diverso per lo stesso plaintext (IV/nonce random), innocuo ma
 * inutile.
 */
export async function persistMemory(
  memory: CoachMemory, userKey: Buffer,
): Promise<{ memory: StorageReceipt; profile: StorageReceipt; memoryCipher: string }> {
  const memCt = encryptJson(memory, userKey);
  const profCt = encryptJson(buildProfile(memory), serviceKey());
  const enc = (s: string) => new TextEncoder().encode(s);
  const [memReceipt, profReceipt] = await Promise.all([
    uploadEncrypted(enc(memCt), userKey),      // doppia protezione: envelope AES nostro + aes256 SDK
    uploadEncrypted(enc(profCt), serviceKey()),
  ]);
  return { memory: memReceipt, profile: profReceipt, memoryCipher: memCt };
}
