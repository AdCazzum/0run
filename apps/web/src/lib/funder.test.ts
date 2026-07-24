import { describe, expect, it, vi } from "vitest";
import { topUpIfNeeded, _setFunderDepsForTest } from "./funder";

describe("funder", () => {
  it("non fonda chi ha già gas", async () => {
    const send = vi.fn();
    _setFunderDepsForTest({ getBalance: async () => 10n ** 17n, send });
    expect((await topUpIfNeeded("0x" + "22".repeat(20))).funded).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it("fonda sotto soglia (0.01 OG) con 0.03 OG", async () => {
    const send = vi.fn(async () => "0xtx");
    _setFunderDepsForTest({ getBalance: async () => 0n, send });
    const r = await topUpIfNeeded("0x" + "22".repeat(20));
    expect(r).toEqual({ funded: true, txHash: "0xtx" });
    expect(send).toHaveBeenCalledWith("0x" + "22".repeat(20), 30000000000000000n);
  });
});
