import { sql } from "drizzle-orm";
import type { AgentKitStorage } from "@worldcoin/agentkit";
import { db } from "@/db";

/**
 * The AgentKit SDK's storage contract implemented over our Postgres. The
 * interface docs require check+increment to be ONE atomic operation; this is
 * a single INSERT … ON CONFLICT … DO UPDATE … WHERE count < limit — the
 * upsert either lands (row returned → allowed) or the WHERE stops it (no row
 * → the human is at their limit). No transaction, no row lock, no race.
 */
export class PostgresAgentKitStorage implements AgentKitStorage {
  async tryIncrementUsage(endpoint: string, humanId: string, limit: number): Promise<boolean> {
    // The first-use INSERT path cannot carry a WHERE, so a non-positive limit
    // must short-circuit here or the very first request would always pass.
    if (limit < 1) return false;
    const res = await db.execute(sql`
      INSERT INTO agentkit_usage (endpoint, human_id, count)
      VALUES (${endpoint}, ${humanId}, 1)
      ON CONFLICT (endpoint, human_id)
      DO UPDATE SET count = agentkit_usage.count + 1
      WHERE agentkit_usage.count < ${limit}
      RETURNING count
    `);
    return res.rows.length > 0;
  }
}

export const agentkitStorage: AgentKitStorage = new PostgresAgentKitStorage();
