import { NextResponse } from "next/server";
import { db } from "@/db";
import { runs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { and, eq } from "drizzle-orm";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;
    const [run] = await db.select().from(runs).where(and(eq(runs.id, Number(id)), eq(runs.userId, user.userId)));
    if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(run);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
