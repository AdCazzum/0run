import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

/** Deploy gate: the app is useless without its database, so an unreachable db is a 503. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, db: true, ts: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, db: false, error: String(e), ts: new Date().toISOString() },
      { status: 503 },
    );
  }
}
