import { CoachProfileSchema, PERSONALITY_STYLE, PersonalitySchema, type CoachProfile } from "@0run/shared";
import { canDecrypt, decryptJson } from "@/lib/crypto/aes";
import { serviceKey } from "@/lib/crypto/keys";
import { downloadDecrypted } from "@/lib/zerog/storage";

export type ConsultProfileSource = "cache" | "storage" | "public-row";

/**
 * The one slice of a coach that a stranger-facing consultation may read: the
 * service-key-encrypted PROFILE (name, personality, totals, pace trend, style
 * notes) — never memoryRoot/memoryCipher (owner-wallet-key encrypted). Cache
 * → 0G Storage → degraded public row, in that order, for the same reason as
 * the ask route this was extracted from: a freshly uploaded blob is not
 * downloadable from 0G Storage for 16+ minutes.
 */
export async function loadConsultProfile(coach: {
  tokenId: string;
  name: string;
  personality: string;
  profileRoot: string;
  profileCipher: string | null;
}): Promise<{ profile: CoachProfile; profileSource: ConsultProfileSource }> {
  const svcKey = serviceKey();
  let profileCipherText: string | null = coach.profileCipher;
  if (!profileCipherText) {
    const dl = await downloadDecrypted(coach.profileRoot, svcKey, (b) => canDecrypt(b.toString("utf8"), svcKey));
    if (dl.ok) profileCipherText = dl.data.toString("utf8");
    else console.warn(`consult-profile: profile download for coach ${coach.tokenId} failed`, dl.error);
  }

  const profileSource: ConsultProfileSource = coach.profileCipher ? "cache" : profileCipherText ? "storage" : "public-row";
  const profile: CoachProfile = profileCipherText
    ? decryptJson(profileCipherText, svcKey, CoachProfileSchema)
    : {
        version: 1 as const,
        name: coach.name,
        personality: PersonalitySchema.parse(coach.personality),
        totals: { runs: 0, km: 0 },
        paceTrend: [],
        styleNotes: PERSONALITY_STYLE[PersonalitySchema.parse(coach.personality)],
      };
  return { profile, profileSource };
}
