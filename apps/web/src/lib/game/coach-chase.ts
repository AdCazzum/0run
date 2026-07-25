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
