import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { coaches, runs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { initialSteps, processRun } from "@/lib/coach/pipeline";

/** Feed for the dashboard: the caller's runs, newest first, plus the coach header. */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req);
    const [rows, coachRows] = await Promise.all([
      db.select().from(runs).where(eq(runs.userId, user.userId)).orderBy(desc(runs.createdAt)),
      db.select().from(coaches).where(eq(coaches.userId, user.userId)),
    ]);
    // A row still holding the empty-tokenId placeholder is only a mint reservation
    // (see the mint route), so the dashboard must treat it as "no coach yet".
    const coach = coachRows.find((c) => c.tokenId !== "") ?? null;
    return NextResponse.json({
      runs: rows,
      coach: coach && {
        id: coach.id, name: coach.name, personality: coach.personality,
        tokenId: coach.tokenId, mintTx: coach.mintTx, ensName: coach.ensName,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

// Free text is more sensitive than pace/elevation — it can carry health or
// mood information — so it gets its own explicit cap, checked BEFORE the
// pipeline ever sees it. Oversize input is rejected (400), never silently
// truncated: truncating would let the athlete believe the coach read
// something it never saw.
const MAX_FEELINGS_CHARS = 1000;

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const form = await req.formData();
    const gpx = form.get("gpx"), keyHex = form.get("userKeyHex"), feelingsRaw = form.get("feelings");
    if (!(gpx instanceof File) || typeof keyHex !== "string" || keyHex.length !== 64)
      return NextResponse.json({ error: "gpx file e userKeyHex richiesti" }, { status: 400 });

    // Optional multipart part. Not a string at all (e.g. a stray File under
    // the same field name) is rejected rather than coerced. Whitespace-only
    // input collapses to "absent" (null) — an athlete who typed nothing
    // meaningful shouldn't get an empty feelings entry in their history.
    let feelings: string | null = null;
    if (feelingsRaw !== null) {
      if (typeof feelingsRaw !== "string")
        return NextResponse.json({ error: "feelings deve essere testo" }, { status: 400 });
      const trimmed = feelingsRaw.trim();
      if (trimmed.length > MAX_FEELINGS_CHARS)
        return NextResponse.json({ error: `feelings deve essere al massimo ${MAX_FEELINGS_CHARS} caratteri` }, { status: 400 });
      feelings = trimmed.length > 0 ? trimmed : null;
    }

    const xml = await gpx.text();
    const [run] = await db.insert(runs).values({ userId: user.userId, status: "processing", steps: initialSteps() }).returning();
    // Fire-and-forget: real inference (~20s) + 0G Storage finality (minutes)
    // make this too slow for a synchronous request. The client polls
    // GET /api/runs/:id for status instead (see docs/0g-reality-check.md).
    void processRun(run.id, user.userId, xml, Buffer.from(keyHex, "hex"), feelings);
    return NextResponse.json({ runId: run.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
