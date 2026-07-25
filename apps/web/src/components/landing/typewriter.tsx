"use client";
import { useEffect, useRef, useState } from "react";

type Phase = "typing" | "holding" | "deleting";

const TYPE_MS = 72;
const DELETE_MS = 38;
const HOLD_MS = 1900;
const GAP_MS = 320;

/** Honours the OS setting at mount and keeps following it if the user changes it. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    // No matchMedia at all (very old browsers, some test environments): treat
    // it as "no stated preference" rather than crashing the page it is on.
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * One word of a headline, typed and retyped through a list.
 *
 * Three things this deliberately does NOT do:
 *
 * - It never animates for a reader who asked not to be animated: with
 *   prefers-reduced-motion the first word is simply rendered, in full.
 * - It never puts moving text in the accessibility tree. Assistive tech reads
 *   the visually-hidden `words[0]` (so the heading is a whole sentence, once),
 *   and the animated copy is aria-hidden — otherwise every keystroke would be
 *   announced as a change to the page's main heading.
 * - It never reserves the width of the longest word. The word sits at the
 *   start of its own line, so a shifting right edge is exactly what a
 *   typewriter looks like; padding it out would just decentre the line.
 *
 * The full stop appears only once a word is complete, so mid-typing reads as
 * an unfinished word rather than a broken sentence.
 */
export function Typewriter({ words, className }: { words: string[]; className?: string }) {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [length, setLength] = useState(words[0].length);
  const [phase, setPhase] = useState<Phase>("holding");
  // Ref, not state: the animation reads this without wanting to restart when
  // it changes (a hover must not re-trigger typing).
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (reduced || words.length < 2) return;

    const word = words[index];
    const step = () => {
      if (phase === "typing") {
        if (length < word.length) setLength(length + 1);
        else setPhase("holding");
      } else if (phase === "holding") {
        setPhase("deleting");
      } else {
        if (length > 0) setLength(length - 1);
        else {
          setIndex((i) => (i + 1) % words.length);
          setPhase("typing");
        }
      }
    };

    const delay =
      phase === "holding" ? HOLD_MS : phase === "deleting" ? (length > 0 ? DELETE_MS : GAP_MS) : TYPE_MS;
    timer.current = setTimeout(step, delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [reduced, words, index, length, phase]);

  const visible = words[index].slice(0, length);
  const complete = visible === words[index];

  return (
    <>
      <span className="sr-only">{words[0]}.</span>
      <span aria-hidden className={className}>
        {visible}
        {complete && "."}
        <span
          className="ml-[0.06em] inline-block w-[0.055em] self-stretch bg-orange align-[-0.05em]"
          style={{ height: "0.78em", animation: "orun-caret-blink 1.05s steps(1, end) infinite" }}
        />
      </span>
    </>
  );
}
