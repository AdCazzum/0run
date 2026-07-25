# Coach Chase Playable Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome-dino-style minigame shown on `/runs/[id]` while the pipeline is `processing`: a pixel runner flees the whip-cracking coach, jumping/ducking Ethereum-diamond obstacles.

**Architecture:** Pure game logic (state + `tick`) in `apps/web/src/lib/game/coach-chase.ts`, unit-tested with an injectable RNG. A client component `apps/web/src/components/run/coach-chase.tsx` renders that state on a fixed-resolution `<canvas>` (600×150, CSS-scaled), handles keyboard+touch, and mounts above `<PipelineSteps>` only while `status === "processing"`.

**Tech Stack:** React 19 client component, Canvas 2D, vitest. Zero new dependencies, zero image assets (sprites are pixel matrices in code).

Spec: `docs/superpowers/specs/2026-07-25-coach-chase-loader-design.md`.

## Global Constraints

- Palette (from `apps/web/src/app/globals.css`): navy `#004E89`, ocean `#1A659E`, orange `#FF6B35`; canvas background stays transparent over the page's cream.
- Copy in English, tiny-uppercase style like the rest of the app.
- `prefers-reduced-motion: reduce` → the component renders nothing (static loader unchanged).
- Inputs: Space/↑ = jump, ↓ (held) = duck; touch: tap upper canvas = jump, touch held on lower ~40% = duck. Space/tap restarts after game over.
- No sounds, no persistence beyond a session best in a ref.
- Tests: vitest, colocated, run from `apps/web/` with `npx vitest run <path>`.
- Commit messages exactly as given, each with trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Pure game logic

**Files:**
- Create: `apps/web/src/lib/game/coach-chase.ts`
- Test: `apps/web/src/lib/game/coach-chase.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 2):
  - `WORLD` constants object (see code)
  - `type ObstacleKind = "ground" | "float"`, `type Obstacle = { kind: ObstacleKind; x: number }`
  - `type Input = { jump: boolean; duck: boolean }`
  - `type GameState` (see code)
  - `newGame(): GameState`
  - `tick(s: GameState, dtRaw: number, input: Input, rng?: () => number): GameState` — pure-ish (mutates and returns `s`)
  - `runnerBox(s: GameState): Box`, `obstacleBox(o: Obstacle): Box` with `type Box = { x: number; y: number; w: number; h: number }`
  - `scoreMeters(s: GameState): number`
  - `minGapPx(speed: number): number`

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/game/coach-chase.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  WORLD, newGame, tick, runnerBox, obstacleBox, scoreMeters, minGapPx,
  type GameState, type Input,
} from "./coach-chase";

const IDLE: Input = { jump: false, duck: false };
const JUMP: Input = { jump: true, duck: false };
const DUCK: Input = { jump: false, duck: true };
// rng pinned to 0: spawn gap is exactly minGapPx, kind is "ground".
const rng0 = () => 0;

function run(s: GameState, seconds: number, input: Input = IDLE) {
  for (let t = 0; t < seconds; t += 0.016) tick(s, 0.016, input, rng0);
  return s;
}

describe("coach-chase game logic", () => {
  it("starts running, on the ground, score 0", () => {
    const s = newGame();
    expect(s.status).toBe("running");
    expect(s.runnerY).toBe(WORLD.groundY);
    expect(scoreMeters(s)).toBe(0);
  });

  it("jump leaves the ground, clears at least an obstacle's height, and lands back", () => {
    const s = newGame();
    s.spawnIn = 100000; // no obstacles in this test
    tick(s, 0.016, JUMP, rng0);
    expect(s.airborne).toBe(true);
    let apexFeet = WORLD.groundY;
    for (let i = 0; i < 100 && s.airborne; i++) {
      tick(s, 0.016, IDLE, rng0);
      apexFeet = Math.min(apexFeet, s.runnerY);
    }
    expect(s.airborne).toBe(false);
    expect(s.runnerY).toBe(WORLD.groundY);
    // must clear a ground diamond (18px) with margin
    expect(WORLD.groundY - apexFeet).toBeGreaterThan(WORLD.obstacle.groundH + 6);
  });

  it("ducking shrinks the hitbox and only works on the ground", () => {
    const s = newGame();
    s.spawnIn = 100000;
    const standing = runnerBox(s);
    tick(s, 0.016, DUCK, rng0);
    const ducked = runnerBox(s);
    expect(ducked.h).toBeLessThan(standing.h);
    expect(ducked.y).toBeGreaterThan(standing.y);
    // duck ignored mid-air
    const s2 = newGame();
    s2.spawnIn = 100000;
    tick(s2, 0.016, JUMP, rng0);
    tick(s2, 0.016, DUCK, rng0);
    expect(s2.ducking).toBe(false);
  });

  it("standing into a ground diamond → dead; already-airborne feet above it → alive", () => {
    const dead = newGame();
    dead.obstacles.push({ kind: "ground", x: WORLD.runnerX });
    tick(dead, 0.016, IDLE, rng0);
    expect(dead.status).toBe("dead");

    const alive = newGame();
    alive.airborne = true;
    alive.runnerY = WORLD.groundY - 40; // feet well above an 18px diamond
    alive.vy = 0;
    alive.obstacles.push({ kind: "ground", x: WORLD.runnerX });
    tick(alive, 0.016, IDLE, rng0);
    expect(alive.status).toBe("running");
  });

  it("floating diamond hits a standing runner but not a ducking one", () => {
    const hit = newGame();
    hit.obstacles.push({ kind: "float", x: WORLD.runnerX });
    tick(hit, 0.016, IDLE, rng0);
    expect(hit.status).toBe("dead");

    const safe = newGame();
    safe.obstacles.push({ kind: "float", x: WORLD.runnerX });
    tick(safe, 0.016, DUCK, rng0);
    // duck happens before collision check in the same tick
    expect(safe.status).toBe("running");
  });

  it("speed ramps monotonically and caps at maxSpeed", () => {
    const s = newGame();
    s.spawnIn = 1000000;
    const v0 = s.speed;
    run(s, 5);
    const v5 = s.speed;
    expect(v5).toBeGreaterThan(v0);
    run(s, 120);
    expect(s.speed).toBeLessThanOrEqual(WORLD.maxSpeed);
    expect(s.speed).toBe(WORLD.maxSpeed);
  });

  it("obstacles spawn off-screen right with at least the minimum clearable gap", () => {
    const s = newGame();
    run(s, 30); // plenty of spawns at rng 0
    expect(s.obstacles.length).toBeGreaterThan(0);
    for (const o of s.obstacles) expect(o.x).toBeGreaterThan(-30);
    // with rng()=0 consecutive spawn distances are exactly minGapPx(speed) apart,
    // and minGapPx at max speed must exceed a full jump's horizontal travel
    const jumpAir = (2 * -WORLD.jumpVy) / WORLD.gravity;
    expect(minGapPx(WORLD.maxSpeed)).toBeGreaterThan(WORLD.maxSpeed * jumpAir * 0.6);
  });

  it("clamps dt: one 1-second frame advances at most maxDt worth of world", () => {
    const s = newGame();
    s.spawnIn = 100000;
    const before = s.distance;
    tick(s, 1, IDLE, rng0);
    expect(s.distance - before).toBeLessThanOrEqual(WORLD.maxSpeed * WORLD.maxDt + 1);
  });

  it("dead state is frozen until restart", () => {
    const s = newGame();
    s.obstacles.push({ kind: "ground", x: WORLD.runnerX });
    tick(s, 0.016, IDLE, rng0);
    expect(s.status).toBe("dead");
    const d = s.distance;
    tick(s, 0.016, IDLE, rng0);
    expect(s.distance).toBe(d);
  });

  it("boxes: obstacleBox geometry matches WORLD", () => {
    expect(obstacleBox({ kind: "ground", x: 100 })).toEqual({
      x: 100, y: WORLD.groundY - WORLD.obstacle.groundH,
      w: WORLD.obstacle.groundW, h: WORLD.obstacle.groundH,
    });
    expect(obstacleBox({ kind: "float", x: 100 })).toEqual({
      x: 100, y: WORLD.obstacle.floatBottomY - WORLD.obstacle.floatH,
      w: WORLD.obstacle.floatW, h: WORLD.obstacle.floatH,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web/`): `npx vitest run src/lib/game/coach-chase.test.ts`
Expected: FAIL — cannot resolve `./coach-chase`.

- [ ] **Step 3: Write the implementation**

`apps/web/src/lib/game/coach-chase.ts`:

```ts
/**
 * Pure game logic for the "Coach Chase" loader minigame (spec
 * docs/superpowers/specs/2026-07-25-coach-chase-loader-design.md).
 * No canvas, no React, no globals: the component owns the rAF loop and
 * rendering; this module owns physics, spawning, and collisions, so the
 * whole game can be unit-tested headless with a pinned RNG.
 *
 * Geometry (y grows downward, like canvas):
 * - groundY 130 is where feet rest.
 * - standing hitbox 16×28 → top at 102; duck hitbox 22×16 → top at 114.
 * - floating diamond occupies y 92..112: overlaps a standing runner,
 *   clears a ducking one by 2px. Ground diamond y 112..130: duck does NOT
 *   save you, only a jump does. These three numbers are load-bearing.
 */
export const WORLD = {
  width: 600,
  height: 150,
  groundY: 130,
  runnerX: 70,
  runnerW: 16,
  runnerH: 28,
  duckW: 22,
  duckH: 16,
  gravity: 2400, // px/s²
  jumpVy: -620, // px/s → apex ≈ 80px above ground
  baseSpeed: 240, // px/s
  speedRamp: 8, // +px/s per second of play
  maxSpeed: 520,
  obstacle: { groundW: 18, groundH: 18, floatW: 20, floatH: 20, floatBottomY: 112 },
  maxDt: 0.032, // s — clamp so a background tab never teleports the world
} as const;

export type ObstacleKind = "ground" | "float";
export type Obstacle = { kind: ObstacleKind; x: number };
export type Input = { jump: boolean; duck: boolean };
export type Box = { x: number; y: number; w: number; h: number };

export type GameState = {
  status: "running" | "dead";
  t: number; // seconds played
  distance: number; // px scrolled
  speed: number; // px/s
  runnerY: number; // feet y
  vy: number;
  airborne: boolean;
  ducking: boolean;
  obstacles: Obstacle[];
  spawnIn: number; // px of scroll until the next spawn
};

export function newGame(): GameState {
  return {
    status: "running",
    t: 0,
    distance: 0,
    speed: WORLD.baseSpeed,
    runnerY: WORLD.groundY,
    vy: 0,
    airborne: false,
    ducking: false,
    obstacles: [],
    // first obstacle arrives after a friendly warm-up
    spawnIn: WORLD.width * 0.9,
  };
}

export function scoreMeters(s: GameState): number {
  return Math.floor(s.distance / 10);
}

/** Minimum scroll distance between spawns — always jumpable at that speed. */
export function minGapPx(speed: number): number {
  return speed * 0.55 + 90;
}

export function runnerBox(s: GameState): Box {
  if (s.ducking) {
    return { x: WORLD.runnerX, y: s.runnerY - WORLD.duckH, w: WORLD.duckW, h: WORLD.duckH };
  }
  return { x: WORLD.runnerX, y: s.runnerY - WORLD.runnerH, w: WORLD.runnerW, h: WORLD.runnerH };
}

export function obstacleBox(o: Obstacle): Box {
  if (o.kind === "ground") {
    return { x: o.x, y: WORLD.groundY - WORLD.obstacle.groundH, w: WORLD.obstacle.groundW, h: WORLD.obstacle.groundH };
  }
  return { x: o.x, y: WORLD.obstacle.floatBottomY - WORLD.obstacle.floatH, w: WORLD.obstacle.floatW, h: WORLD.obstacle.floatH };
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Advances the world by one frame. Mutates and returns `s` (the component
 * keeps it in a ref). `rng` is injectable so tests are deterministic.
 */
export function tick(s: GameState, dtRaw: number, input: Input, rng: () => number = Math.random): GameState {
  if (s.status === "dead") return s;
  const dt = Math.min(dtRaw, WORLD.maxDt);
  s.t += dt;
  s.speed = Math.min(WORLD.maxSpeed, WORLD.baseSpeed + WORLD.speedRamp * s.t);

  // Duck only sticks on the ground; a mid-air duck request is ignored.
  s.ducking = input.duck && !s.airborne;

  if (input.jump && !s.airborne && !s.ducking) {
    s.vy = WORLD.jumpVy;
    s.airborne = true;
  }

  if (s.airborne) {
    s.vy += WORLD.gravity * dt;
    s.runnerY += s.vy * dt;
    if (s.runnerY >= WORLD.groundY) {
      s.runnerY = WORLD.groundY;
      s.vy = 0;
      s.airborne = false;
    }
  }

  const dx = s.speed * dt;
  s.distance += dx;
  for (const o of s.obstacles) o.x -= dx;
  s.obstacles = s.obstacles.filter((o) => o.x > -30);

  s.spawnIn -= dx;
  if (s.spawnIn <= 0) {
    const kind: ObstacleKind = rng() < 0.6 ? "ground" : "float";
    s.obstacles.push({ kind, x: WORLD.width + 30 });
    s.spawnIn = minGapPx(s.speed) + rng() * 220;
  }

  const rb = runnerBox(s);
  for (const o of s.obstacles) {
    if (overlaps(rb, obstacleBox(o))) {
      s.status = "dead";
      break;
    }
  }
  return s;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/game/coach-chase.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/game/coach-chase.ts apps/web/src/lib/game/coach-chase.test.ts
git commit -m "feat(web): coach-chase game logic — dino physics, ETH obstacles, headless-testable"
```

---

### Task 2: Canvas component + page integration

**Files:**
- Create: `apps/web/src/components/run/coach-chase.tsx`
- Modify: `apps/web/src/app/(app)/runs/[id]/page.tsx:93-98` (processing section)

**Interfaces:**
- Consumes (from Task 1): `WORLD`, `newGame`, `tick`, `runnerBox`, `obstacleBox`, `scoreMeters`, `type GameState`, `type Input` from `@/lib/game/coach-chase`.
- Produces: `<CoachChase />` client component, self-contained, no props.

No new unit test (presentational; the logic is covered by Task 1). Verification = typecheck + build + manual play.

- [ ] **Step 1: Write the component**

`apps/web/src/components/run/coach-chase.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import {
  WORLD, newGame, tick, runnerBox, obstacleBox, scoreMeters,
  type GameState, type Input,
} from "@/lib/game/coach-chase";

// Palette from globals.css — canvas can't use Tailwind classes.
const NAVY = "#004E89";
const OCEAN = "#1A659E";
const ORANGE = "#FF6B35";

// --- pixel sprites ('#' = filled cell, drawn at PX pixels per cell) --------
const PX = 2;

const RUNNER_A = [
  "...###....",
  "...###....",
  "....#.....",
  "..#####...",
  ".#..#..#..",
  "#...#...#.",
  "....#.....",
  "...##.....",
  "..#..##...",
  ".#.....#..",
  "#.......#.",
  "#........#",
];
const RUNNER_B = [
  "...###....",
  "...###....",
  "....#.....",
  "..#####...",
  ".#..#..#..",
  "#...#...#.",
  "....#.....",
  "...##.....",
  "...#.#....",
  "...#..#...",
  "..#....#..",
  ".##.....#.",
];
const RUNNER_DUCK = [
  "......###..",
  "..#...###..",
  ".#.#####...",
  "#..#####...",
  ".##..##.#..",
  ".#.##....#.",
];
const COACH_A = [
  "..###.......",
  "..###....#..",
  "...#....#...",
  ".#####.#....",
  "#..#..#.....",
  "...#........",
  "..###.......",
  ".#...#......",
  "#.....#.....",
  "#......#....",
];
const COACH_B = [
  "..###.......",
  "..###..#####",
  "...#..#.....",
  ".#####......",
  "#..#........",
  "...#........",
  "..###.......",
  ".#...#......",
  "#.....#.....",
  "#......#....",
];
const DIAMOND = [
  "....##....",
  "...####...",
  "..######..",
  ".########.",
  "##########",
  ".########.",
  "..######..",
  "...####...",
  "....##....",
];

function drawSprite(ctx: CanvasRenderingContext2D, art: string[], x: number, y: number, color: string) {
  ctx.fillStyle = color;
  for (let r = 0; r < art.length; r++) {
    for (let c = 0; c < art[r].length; c++) {
      if (art[r][c] === "#") ctx.fillRect(x + c * PX, y + r * PX, PX, PX);
    }
  }
}

/**
 * The playable loader (spec 2026-07-25-coach-chase-loader-design.md): the
 * athlete outruns their whip-cracking coach while the real pipeline works.
 * All game state lives in refs — React re-renders would drop frames; the
 * only useState is the reduced-motion gate resolved on mount.
 */
export function CoachChase() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>(newGame());
  const inputRef = useRef<Input & { jumpQueued: boolean }>({ jump: false, duck: false, jumpQueued: false });
  const bestRef = useRef(0);
  // null = not yet known (avoids SSR/client mismatch); true = show the game.
  const [active, setActive] = useState<boolean | null>(null);

  useEffect(() => {
    setActive(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        inputRef.current.jumpQueued = true;
      }
      if (e.code === "ArrowDown") {
        e.preventDefault();
        inputRef.current.duck = true;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "ArrowDown") inputRef.current.duck = false;
    };
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const y = e.touches[0].clientY - rect.top;
      // lower ~40% of the canvas = duck (held), everything above = jump
      if (y > rect.height * 0.6) inputRef.current.duck = true;
      else inputRef.current.jumpQueued = true;
    };
    const onTouchEnd = () => {
      inputRef.current.duck = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd);

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const s = stateRef.current;
      const jump = inputRef.current.jumpQueued;
      inputRef.current.jumpQueued = false;

      if (s.status === "dead") {
        bestRef.current = Math.max(bestRef.current, scoreMeters(s));
        if (jump) stateRef.current = newGame();
      } else {
        tick(s, dt, { jump, duck: inputRef.current.duck });
      }
      draw(ctx, stateRef.current, bestRef.current, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchend", onTouchEnd);
    };
  }, [active]);

  if (!active) return null;

  return (
    <div className="max-w-xl">
      <canvas
        ref={canvasRef}
        width={WORLD.width}
        height={WORLD.height}
        role="img"
        aria-label="mini game: outrun your coach while the report is prepared"
        className="w-full touch-none select-none"
        style={{ imageRendering: "pixelated" }}
      />
      <p className="mt-2 font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">
        space / tap to jump · ↓ / hold low to duck
      </p>
    </div>
  );
}

function draw(ctx: CanvasRenderingContext2D, s: GameState, best: number, now: number) {
  ctx.clearRect(0, 0, WORLD.width, WORLD.height);

  // dashed ground, dino-style
  ctx.strokeStyle = NAVY;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath();
  ctx.moveTo(0, WORLD.groundY + 2);
  ctx.lineTo(WORLD.width, WORLD.groundY + 2);
  ctx.stroke();
  ctx.setLineDash([]);

  const stride = Math.floor(now / 100) % 2 === 0;

  // the coach, whip cracking, always a few steps behind
  const coachArt = s.status === "dead" || stride ? COACH_B : COACH_A;
  const coachColor = s.status === "dead" ? ORANGE : OCEAN;
  drawSprite(ctx, coachArt, 16, WORLD.groundY - COACH_A.length * PX, coachColor);

  // the athlete (you)
  const rb = runnerBox(s);
  if (s.ducking) {
    drawSprite(ctx, RUNNER_DUCK, rb.x - 2, WORLD.groundY - RUNNER_DUCK.length * PX, NAVY);
  } else {
    const art = s.airborne ? RUNNER_A : stride ? RUNNER_A : RUNNER_B;
    drawSprite(ctx, art, rb.x - 2, rb.y, NAVY);
  }

  // ETH diamonds
  for (const o of s.obstacles) {
    const b = obstacleBox(o);
    drawSprite(ctx, DIAMOND, b.x, b.y, NAVY);
  }

  // score
  ctx.fillStyle = OCEAN;
  ctx.font = "10px monospace";
  ctx.textAlign = "right";
  ctx.fillText(`${scoreMeters(s)} m`, WORLD.width - 6, 14);

  if (s.status === "dead") {
    ctx.fillStyle = ORANGE;
    ctx.textAlign = "center";
    ctx.font = "bold 12px monospace";
    ctx.fillText(`CAUGHT! ${scoreMeters(s)} m · BEST ${best} m`, WORLD.width / 2, 58);
    ctx.font = "10px monospace";
    ctx.fillText("space / tap to run again", WORLD.width / 2, 76);
  }
}
```

- [ ] **Step 2: Mount it in the processing section**

In `apps/web/src/app/(app)/runs/[id]/page.tsx`, add the import next to the other run components:

```tsx
import { CoachChase } from "@/components/run/coach-chase";
```

and replace the processing section (lines 93-98) with:

```tsx
      {run.status === "processing" && (
        <section className="mt-6 border-t border-navy pt-8">
          <Label>The coach is working</Label>
          <div className="mt-6"><CoachChase /></div>
          <div className="mt-8 max-w-md"><PipelineSteps steps={run.steps} /></div>
        </section>
      )}
```

(The `status === "error"` section keeps only `PipelineSteps` — no game on a failed run.)

- [ ] **Step 3: Typecheck, full suite, build**

Run (from `apps/web/`): `npx tsc --noEmit && npx vitest run && npm run build`
Expected: all clean. (Build needs `NEXT_PUBLIC_PRIVY_APP_ID` from the root `.env` if it fails in prerender — see repo memory; export it inline if needed.)

- [ ] **Step 4: Manual smoke**

`npm run dev` from repo root, upload a run (or open an existing processing one) and confirm: game renders above the steps, jump/duck work, collision shows CAUGHT + best, space restarts, and the page still swaps to the report when the pipeline finishes.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/run/coach-chase.tsx "apps/web/src/app/(app)/runs/[id]/page.tsx"
git commit -m "feat(web): Coach Chase — playable dino-style loader while the coach works"
```

---

## Out of scope (from the spec)

Sounds, persistent high scores, leaderboards, gamepad, showing the game outside the processing state.
