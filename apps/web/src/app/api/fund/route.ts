import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { topUpIfNeeded } from "@/lib/funder";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

const FUNDING_CAP = 3; // lifetime top-ups per user (0.09 OG max per user)

export async function POST(req: Request) {
  try {
    const { userId, wallet } = await requireUser(req);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user || user.fundedCount >= FUNDING_CAP) {
      return NextResponse.json({ error: "funding cap reached" }, { status: 429 });
    }
    const result = await topUpIfNeeded(wallet);
    if (result.funded) {
      await db.update(users).set({ fundedCount: sql`${users.fundedCount} + 1` }).where(eq(users.id, userId));
    }
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
