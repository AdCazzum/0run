"use client";
import { useEffect, useRef, useState } from "react";
import {
  WORLD, newGame, tick, runnerBox, obstacleBox, scoreMeters,
  type GameState,
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
  const inputRef = useRef<{ duck: boolean; jumpQueued: boolean }>({ duck: false, jumpQueued: false });
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
      // Don't hijack Space/arrows from a focused link, button, or form field —
      // e.g. tabbing to "all runs" or the delete button and pressing Space
      // must activate that control, not the game.
      const t = e.target as HTMLElement | null;
      if (t && t.closest("a,button,input,textarea,select,[contenteditable]")) return;

      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        // OS key auto-repeat fires keydown repeatedly while held; without this
        // guard, holding Space through death auto-restarts the very next tick.
        if (!e.repeat) inputRef.current.jumpQueued = true;
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
      // On the dead screen, the copy says "tap to run again" — any tap
      // restarts, regardless of where on the canvas it lands.
      if (stateRef.current.status === "dead") {
        inputRef.current.jumpQueued = true;
        return;
      }
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
    // touchcancel fires when the OS interrupts a touch (notification, edge
    // gesture) — without clearing duck here too, the runner gets stuck
    // ducked and can never jump again.
    canvas.addEventListener("touchcancel", onTouchEnd);

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
      canvas.removeEventListener("touchcancel", onTouchEnd);
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
    const art = s.status === "dead" ? RUNNER_A : s.airborne ? RUNNER_A : stride ? RUNNER_A : RUNNER_B;
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
