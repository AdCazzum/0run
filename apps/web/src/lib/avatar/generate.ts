import type { Personality } from "@0run/shared";

/**
 * A coach's face, generated once when the coach is created.
 *
 * Runs on 0G Compute's async image endpoint (`z-image-turbo`), the same router
 * the coaching text goes through — and, unlike the text path, this one returns
 * a TEE attestation per job (`x_0g_trace.tee_verified`), so the avatar is a
 * second, visible piece of verifiable 0G work rather than a decoration.
 *
 * Never throws. An avatar is a nicety: a coach without one is a fully working
 * coach, so every failure here returns a receipt the caller can log and ignore.
 */
export type AvatarResult =
  | { ok: true; pngBase64: string; model: string; teeVerified: boolean; jobId: string; costWei: string | null }
  | { ok: false; error: string };

const MODEL = "z-image-turbo";
const SIZE = "512x512";
// Observed: the job completes in about a second. This ceiling is for the case
// where it does not — a background step must end, not linger for a whole day.
const POLL_ATTEMPTS = 20;
const POLL_INTERVAL_MS = 1_500;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * How each personality looks, in the anime register.
 *
 * The three read as three different people to train with: the pacer is warm,
 * the coach is composed, the drill sergeant is genuinely intimidating and
 * carries a whip. The intensity is in posture, expression and light — an
 * athlete in training gear, drawn as a character, never as a pin-up: this
 * image sits next to a coach's name in a public directory and on a page any
 * judge or stranger can open.
 */
const PERSONALITY_MOTIF: Record<Personality, string> = {
  pacer:
    "warm and encouraging, gentle smile, relaxed posture, hand raised in greeting, soft morning light, running singlet and shorts",
  coach:
    "composed and analytical, arms crossed, level gaze, stopwatch around the neck, clean studio light, track jacket",
  drill_sergeant:
    "severe and relentless, sharp glare, coiled whip held in one hand, hard rim light and deep shadows, cap and training gear",
};

/**
 * The prompt for one specific coach.
 *
 * Deterministic on purpose: the same coach always describes itself the same
 * way, so a regenerated avatar stays recognisably the same character. The name
 * and token id are in the text precisely to make two coaches with the same
 * personality come out different.
 */
export function buildAvatarPrompt(name: string, personality: Personality, tokenId: string): string {
  const motif = PERSONALITY_MOTIF[personality] ?? PERSONALITY_MOTIF.coach;
  return [
    `Anime character portrait of a running coach named "${name}" (agent ${tokenId}).`,
    motif + ".",
    "Modern anime illustration, cel shading, crisp linework, expressive eyes, dynamic bust composition.",
    "An adult athlete in modest athletic sportswear, tasteful and non-sexualised.",
    "Palette leaning on: cream #EFEFD0 background, deep navy #004E89, ocean blue #1A659E, peach #F7C59F, orange #FF6B35 accents.",
    "Square, centred, no text, no letters, no numbers, no logos, no watermark.",
  ].join(" ");
}

type Fetcher = typeof fetch;
let fetcher: Fetcher | null = null;
/** Test seam: same shape as the other network modules in this codebase. */
export function _setFetchForTest(f: Fetcher | null) {
  fetcher = f;
}
const http = (): Fetcher => fetcher ?? fetch;

function config(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = process.env.ROUTER_API_URL;
  const apiKey = process.env.ROUTER_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
}

export async function generateAvatar(prompt: string): Promise<AvatarResult> {
  const cfg = config();
  if (!cfg) return { ok: false, error: "ROUTER_API_URL/ROUTER_API_KEY non configurati" };

  try {
    const submitted = await postJson(cfg, "/async/images/generations", {
      model: MODEL,
      prompt,
      n: 1,
      size: SIZE,
      response_format: "b64_json",
      // Ask for the attestation. It is recorded as what it is — verified,
      // not verified, or unknown — and never asserted when absent.
      verify_tee: true,
    });
    const jobId: string | undefined = submitted?.jobId;
    // The provider that accepted the job is part of its address: polling
    // without it is answered "provider_address query parameter is required".
    const provider: string | undefined = submitted?.provider_address;
    if (!jobId || !provider) return { ok: false, error: `risposta di submit inattesa: ${JSON.stringify(submitted).slice(0, 200)}` };

    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
      const job = await getJson(
        cfg,
        `/async/jobs/${encodeURIComponent(jobId)}?provider_address=${encodeURIComponent(provider)}&verify_tee=true`,
      );
      const status: string = job?.status ?? "unknown";
      if (status === "failed" || status === "error") {
        return { ok: false, error: `job ${jobId} fallito: ${JSON.stringify(job?.error ?? job).slice(0, 200)}` };
      }
      const pngBase64: string | undefined = job?.data?.data?.[0]?.b64_json;
      if (pngBase64) {
        return {
          ok: true,
          pngBase64,
          model: MODEL,
          teeVerified: job?.x_0g_trace?.tee_verified === true,
          jobId,
          costWei: job?.x_0g_trace?.billing?.total_cost ?? null,
        };
      }
      await sleep(POLL_INTERVAL_MS);
    }
    return { ok: false, error: `job ${jobId} ancora incompleto dopo ${POLL_ATTEMPTS} tentativi` };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : String(e) };
  }
}

async function postJson(cfg: { baseUrl: string; apiKey: string }, path: string, body: unknown): Promise<any> {
  const res = await http()(`${cfg.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return readJson(res, path);
}

async function getJson(cfg: { baseUrl: string; apiKey: string }, path: string): Promise<any> {
  const res = await http()(`${cfg.baseUrl}${path}`, {
    headers: { authorization: `Bearer ${cfg.apiKey}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return readJson(res, path);
}

async function readJson(res: Response, path: string): Promise<any> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${path} → risposta non JSON: ${text.slice(0, 200)}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
