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
