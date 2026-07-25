import { describe, expect, it } from "vitest";
import { db } from "./index";
import { users, runs } from "./schema";
import { eq } from "drizzle-orm";

const enabled = !!process.env.DATABASE_URL;

describe.skipIf(!enabled)("db smoke", () => {
  it("insert+read user e run", async () => {
    const [u] = await db.insert(users).values({ privyDid: `did:test:${Date.now()}`, wallet: "0x" + "11".repeat(20) }).returning();
    const [r] = await db.insert(runs).values({
      userId: u.id, status: "processing",
      steps: { encrypt: { status: "pending" }, store_gpx: { status: "pending" }, update_memory: { status: "pending" }, registry_tx: { status: "pending" }, score: { status: "pending" }, inference: { status: "pending" } },
    }).returning();
    const found = await db.select().from(runs).where(eq(runs.id, r.id));
    expect(found[0].userId).toBe(u.id);
  });
});
