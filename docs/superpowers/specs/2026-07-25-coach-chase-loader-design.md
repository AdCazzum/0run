# Coach Chase — playable loader for the run pipeline

Date: 2026-07-25
Status: approved by Ivan (conversation review)

## Goal

While a run is `processing` on `/runs/[id]` ("The coach is working", 6-step pipeline,
minutes of real waiting), show a Chrome-dino-style minigame instead of a dead wait:
a pixel-art runner (the athlete) flees the coach (behind, cracking a whip); obstacles
are Ethereum-diamond icons scrolling in from the right — ground diamonds are jumped,
floating diamonds are ducked under. Desktop + touch.

## Approach (chosen: hand-rolled Canvas 2D)

Zero dependencies, no image assets: sprites are pixel matrices in code, drawn on a
`<canvas>` with a fixed internal resolution (~600×150, dino-like) scaled responsively
via CSS. `requestAnimationFrame` loop, dino physics (gravity, jump impulse, duck
hitbox), speed ramps with distance. DOM/CSS games and game libraries were rejected
(imprecise collisions / pointless dependency).

## Components

- `apps/web/src/lib/game/coach-chase.ts` — pure game logic, no canvas, no React:
  world state, tick(state, dt, input) → state, obstacle spawning (seeded by
  Math.random at runtime), AABB collision, speed ramp, score in meters. Exported and
  unit-tested.
- `apps/web/src/components/run/coach-chase.tsx` — client component: canvas rendering
  of the pure state, sprite pixel-matrices, input handling (Space/↑ = jump, ↓ = duck
  while held; touch: tap = jump, touch on lower half or swipe down = duck while
  held), rAF loop, game-over / restart, session-best score in a ref.
- `apps/web/src/app/(app)/runs/[id]/page.tsx` — mounts `<CoachChase />` above
  `<PipelineSteps>` inside the existing `status === "processing"` section only.

## Look

Blocky monochrome pixel art in the app palette: navy sprites on the page's cream
background, dashed ground line, orange accent for the whip-crack flash on game over
and the score. Copy in English, tiny uppercase tracking like the rest of the app
(e.g. "outrun your coach — space to jump", "caught! <n> m · best <m> m — tap to retry").

## Behavior details

- Runner fixed near the left; coach sprite a few pixels behind him, whip animating —
  purely decorative until collision, when the whip "catches" the runner (orange flash).
- Obstacles: ground ETH diamond (jump over) and floating ETH diamond at head height
  (duck under). Spawn gaps scale with current speed so everything stays jumpable.
- Speed increases smoothly with distance, dino-style; score = meters survived.
- Game over → freeze + score + best-of-session; Space/tap restarts.
- `prefers-reduced-motion: reduce` → don't mount the game (today's static loader stays).
- Tab hidden → rAF pauses naturally; on resume, dt is clamped so nothing teleports.
- Pipeline finishes mid-game → component unmounts with the section (the report
  replacing the game IS the coach catching up — acceptable and on-theme).

## Testing

Unit tests (vitest, colocated) for the pure logic only: gravity/jump arc returns to
ground, duck shrinks the hitbox, collision detected vs ground/floating diamond,
ducking clears the floating diamond, jumping clears the ground one, speed ramp
monotonic, spawn gap ≥ minimum clearable distance, dt clamp. Canvas rendering and
input wiring are not unit-tested (presentational).

## Out of scope

Sounds, persistent high scores, leaderboards, sharing, showing the game anywhere
else, gamepad support.
