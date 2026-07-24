import {
  CoachMemory, CoachMemorySchema, CoachProfile, CoachProfileSchema, RunSummary, StorageReceipt, PERSONALITY_STYLE,
} from "@0run/shared";
import { encryptJson } from "../crypto/aes";
import { serviceKey } from "../crypto/keys";
import { uploadEncrypted } from "../zerog/storage";

export function appendRun(memory: CoachMemory, run: RunSummary): CoachMemory {
  return CoachMemorySchema.parse({
    ...memory,
    privateLayer: { runs: [...memory.privateLayer.runs, run] },
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

/** Cifra e carica entrambi gli strati. NB: il testo cifrato va dentro un envelope JSON in bytes. */
export async function persistMemory(memory: CoachMemory, userKey: Buffer): Promise<{ memory: StorageReceipt; profile: StorageReceipt }> {
  const memCt = encryptJson(memory, userKey);
  const profCt = encryptJson(buildProfile(memory), serviceKey());
  const enc = (s: string) => new TextEncoder().encode(s);
  const [memReceipt, profReceipt] = await Promise.all([
    uploadEncrypted(enc(memCt), userKey),      // doppia protezione: envelope AES nostro + aes256 SDK
    uploadEncrypted(enc(profCt), serviceKey()),
  ]);
  return { memory: memReceipt, profile: profReceipt };
}
