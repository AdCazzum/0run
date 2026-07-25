import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db");

import { PostgresAgentKitStorage } from "./agentkitStorage";
import { db } from "@/db";

const executeMock = vi.fn();
beforeEach(() => {
  (db.execute as any) = executeMock;
});

describe("PostgresAgentKitStorage.tryIncrementUsage", () => {
  beforeEach(() => executeMock.mockReset());

  it("true quando la statement atomica ritorna una riga (sotto il limite)", async () => {
    executeMock.mockResolvedValueOnce({ rows: [{ count: 3 }] });
    const ok = await new PostgresAgentKitStorage().tryIncrementUsage("a2a:2026-07-25", "0x1234", 20);
    expect(ok).toBe(true);
    // UNA sola statement: check e increment insieme, come richiede il
    // contratto AgentKitStorage (niente TOCTOU).
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("false quando la statement non ritorna righe (limite raggiunto)", async () => {
    executeMock.mockResolvedValueOnce({ rows: [] });
    const ok = await new PostgresAgentKitStorage().tryIncrementUsage("a2a:2026-07-25", "0x1234", 20);
    expect(ok).toBe(false);
  });

  it("limit non positivo → false senza toccare il db (la INSERT del primo uso lo aggirerebbe)", async () => {
    const ok = await new PostgresAgentKitStorage().tryIncrementUsage("a2a:2026-07-25", "0x1234", 0);
    expect(ok).toBe(false);
    expect(executeMock).not.toHaveBeenCalled();
  });
});
