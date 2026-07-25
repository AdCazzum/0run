/**
 * Features that exist, work, and are deliberately not shown yet.
 *
 * Hidden rather than deleted: the routes, APIs, contracts and tests all stay in
 * place, so turning one back on is an environment variable and a restart — no
 * code change, no deploy. Read as functions, not module constants, so a test can
 * exercise both states.
 *
 * NEXT_PUBLIC_ because the header that decides whether to link to a section is a
 * client component; Next inlines these at build time, so flipping one means
 * rebuilding the image (which `deploy.sh` does anyway).
 */

/** Run events and their World-ID-gated claims (/events, /api/events). */
export function eventsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_FEATURE_EVENTS === "1";
}

/** The self-declared "coached by a human" badge (/api/coach-claims). */
export function humanCoachEnabled(): boolean {
  return process.env.NEXT_PUBLIC_FEATURE_HUMAN_COACH === "1";
}
