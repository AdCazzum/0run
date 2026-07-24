import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { topUpIfNeeded } from "@/lib/funder";

export async function POST(req: Request) {
  try {
    const { wallet } = await requireUser(req);
    return NextResponse.json(await topUpIfNeeded(wallet));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
