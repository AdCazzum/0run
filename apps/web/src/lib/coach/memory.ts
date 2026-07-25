import {
  CoachMemory, CoachMemorySchema, CoachMemoryV1Schema, CoachProfile, CoachProfileSchema, HealthSnapshot,
  RunSummary, StorageReceipt, PERSONALITY_STYLE,
} from "@0run/shared";
import { encryptJson } from "../crypto/aes";
import { serviceKey } from "../crypto/keys";
import { prepareEncryptedUpload, uploadEncrypted } from "../zerog/storage";

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
 * Removes a run from the private layer, identified by the GPX root that was
 * anchored when it was stored. Pure, mirrors appendRun.
 *
 * What this can and cannot undo, stated once here because the UI repeats it to
 * the athlete: the run leaves the coach's memory, so it stops shaping any
 * future advice, and the rewritten memory gets a new hash anchored on-chain.
 * The encrypted GPX blob already written to 0G Storage does NOT disappear —
 * storage there is immutable and nobody, us included, can delete it. It stays
 * unreadable without the athlete's own key, and nothing points at it any more.
 */
export function removeRun(memory: CoachMemory, gpxRoot: string): CoachMemory {
  return CoachMemorySchema.parse({
    ...memory,
    privateLayer: {
      ...memory.privateLayer,
      runs: memory.privateLayer.runs.filter((r) => r.gpxRoot !== gpxRoot),
    },
  });
}

/**
 * Rewrites the coach's brief — what it knows, in the athlete's own words.
 * Pure, mirrors setHealthSnapshot. An empty string clears it: "I no longer
 * want to say anything about this coach" is a real intention, and it must be
 * expressible.
 */
export function setExpertise(memory: CoachMemory, expertise: string): CoachMemory {
  const brief = expertise.trim();
  const { expertise: _dropped, ...coach } = memory.coach;
  return CoachMemorySchema.parse({
    ...memory,
    coach: { ...coach, ...(brief ? { expertise: brief } : {}) },
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
    // Carried through every rebuild: the brief is part of who the coach is, not
    // a one-off at creation.
    ...(memory.coach.expertise ? { expertise: memory.coach.expertise } : {}),
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
): Promise<{ memory: StorageReceipt; profile: StorageReceipt; memoryCipher: string; profileCipher: string }> {
  const memCt = encryptJson(memory, userKey);
  const profCt = encryptJson(buildProfile(memory), serviceKey());
  const enc = (s: string) => new TextEncoder().encode(s);
  const [memReceipt, profReceipt] = await Promise.all([
    uploadEncrypted(enc(memCt), userKey),      // doppia protezione: envelope AES nostro + aes256 SDK
    uploadEncrypted(enc(profCt), serviceKey()),
  ]);
  // profileCipher travels with memoryCipher because the two caches must move
  // together: the profile envelope is what a STRANGER consulting this coach
  // reads (api/coach/[tokenId]/ask), so leaving it behind means an edited brief
  // or a deleted run never reaches them — the coach keeps answering from its
  // mint-time self.
  return { memory: memReceipt, profile: profReceipt, memoryCipher: memCt, profileCipher: profCt };
}

/**
 * Commits a rewritten memory the way the mint route does: hash locally now,
 * upload to 0G Storage afterwards.
 *
 * `persistMemory` above waits for both uploads — 3 attempts x 120s per layer in
 * the worst case, which is longer than nginx will hold a proxied request open.
 * That is fine for the run pipeline (already a background job) and wrong for a
 * request a person is waiting on: they get a dead connection while the server
 * quietly finishes the work. So the roots are computed locally (the merkle hash
 * is over the encrypted stream, no network involved), the caller writes them and
 * answers, and `upload()` runs after the response.
 */
export async function prepareMemoryCommit(
  memory: CoachMemory, userKey: Buffer,
): Promise<{
  memoryRoot: string;
  profileRoot: string;
  memoryCipher: string;
  profileCipher: string;
  upload: () => Promise<{ memory: StorageReceipt; profile: StorageReceipt }>;
}> {
  const memCt = encryptJson(memory, userKey);
  const profCt = encryptJson(buildProfile(memory), serviceKey());
  const enc = (s: string) => new TextEncoder().encode(s);
  const [mem, prof] = await Promise.all([
    prepareEncryptedUpload(enc(memCt), userKey),
    prepareEncryptedUpload(enc(profCt), serviceKey()),
  ]);
  return {
    memoryRoot: mem.rootHash,
    profileRoot: prof.rootHash,
    memoryCipher: memCt,
    profileCipher: profCt,
    upload: async () => {
      const [memory, profile] = await Promise.all([mem.upload(), prof.upload()]);
      return { memory, profile };
    },
  };
}
