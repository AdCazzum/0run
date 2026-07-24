import { PrivyClient } from "@privy-io/server-auth";
import { db } from "@/db";
import { users } from "@/db/schema";

const privy = new PrivyClient(process.env.NEXT_PUBLIC_PRIVY_APP_ID!, process.env.PRIVY_APP_SECRET!);

export async function requireUser(req: Request): Promise<{ userId: number; wallet: string; privyDid: string }> {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw Object.assign(new Error("missing token"), { status: 401 });
  const claims = await privy.verifyAuthToken(token).catch(() => { throw Object.assign(new Error("invalid token"), { status: 401 }); });
  const user = await privy.getUser(claims.userId);
  const wallet = user.wallet?.address;
  if (!wallet) throw Object.assign(new Error("no wallet"), { status: 401 });
  const [row] = await db
    .insert(users)
    .values({ privyDid: claims.userId, wallet })
    .onConflictDoUpdate({ target: users.privyDid, set: { wallet } })
    .returning();
  return { userId: row.id, wallet, privyDid: claims.userId };
}
