import { NextResponse } from "next/server";
import { db } from "@/db";
import { runs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { initialSteps, processRun } from "@/lib/coach/pipeline";

export async function POST(req: Request) {
  try {
    const user = await requireUser(req);
    const form = await req.formData();
    const gpx = form.get("gpx"), keyHex = form.get("userKeyHex");
    if (!(gpx instanceof File) || typeof keyHex !== "string" || keyHex.length !== 64)
      return NextResponse.json({ error: "gpx file e userKeyHex richiesti" }, { status: 400 });
    const xml = await gpx.text();
    const [run] = await db.insert(runs).values({ userId: user.userId, status: "processing", steps: initialSteps() }).returning();
    // Fire-and-forget: real inference (~20s) + 0G Storage finality (minutes)
    // make this too slow for a synchronous request. The client polls
    // GET /api/runs/:id for status instead (see docs/0g-reality-check.md).
    void processRun(run.id, user.userId, xml, Buffer.from(keyHex, "hex"));
    return NextResponse.json({ runId: run.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
