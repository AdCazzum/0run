import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.TREASURY_PRIVATE_KEY = "0x" + "11".repeat(32);
process.env.ZG_RPC_URL = "https://example.invalid";

// register.ts talks to ethers.Contract directly (there is no wrapper module
// to mock, unlike mint.test.ts which mocks @/lib/zerog/contracts) — so the
// mock target here is the `ethers` package itself, replaced with fakes for
// the three constructors register.ts touches (Wallet, JsonRpcProvider,
// Contract) plus the one pure helper it calls (toUtf8Bytes). Wallet/Provider
// must be faked too: a real ethers.Wallet would validate TREASURY_PRIVATE_KEY
// eagerly, which would tie this test to a real-looking key for no reason.
const registerFn = vi.fn();
const parseLogFn = vi.fn();

vi.mock("ethers", () => ({
  ethers: {
    // Arrow functions can't be called with `new`; register.ts constructs all
    // three of these, so the mocks must be regular functions.
    Wallet: vi.fn().mockImplementation(function () { return {}; }),
    JsonRpcProvider: vi.fn().mockImplementation(function () { return {}; }),
    Contract: vi.fn().mockImplementation(function () {
      return { register: registerFn, interface: { parseLog: parseLogFn } };
    }),
    toUtf8Bytes: (s: string) => new TextEncoder().encode(s),
  },
}));

import { registerAgent } from "./register";

describe("registerAgent", () => {
  beforeEach(() => {
    registerFn.mockReset();
    parseLogFn.mockReset();
  });

  it("successo → {agentId, txHash}", async () => {
    const receipt = { hash: "0xregtx", logs: [{}] };
    registerFn.mockResolvedValue({ wait: async () => receipt });
    parseLogFn.mockReturnValue({ name: "Registered", args: { agentId: 148n } });

    const r = await registerAgent("42", "https://0run.fun/coach/42");

    expect(r).toEqual({ agentId: "148", txHash: "0xregtx" });
    expect(registerFn).toHaveBeenCalledWith(
      "https://0run.fun/coach/42",
      [{ metadataKey: "0run.tokenId", metadataValue: new TextEncoder().encode("42") }],
    );
  });

  it("revert on-chain → {error}, mai un throw (il mint non deve fallire per questo)", async () => {
    registerFn.mockRejectedValue(new Error("execution reverted: bad thing"));

    const r = await registerAgent("42", "https://0run.fun/coach/42");

    expect(r).toEqual({ error: "execution reverted: bad thing" });
  });

  it("evento Registered assente dai log → {error}, mai un throw", async () => {
    const receipt = { hash: "0xregtx", logs: [{}] };
    registerFn.mockResolvedValue({ wait: async () => receipt });
    parseLogFn.mockReturnValue(null); // nessun log combacia con Registered

    const r = await registerAgent("42", "https://0run.fun/coach/42");

    expect(r).toEqual({ error: "evento Registered non trovato" });
  });

  it("tx.wait() rifiutata (es. timeout RPC) → {error}, mai un throw", async () => {
    registerFn.mockResolvedValue({ wait: async () => { throw new Error("timeout"); } });

    const r = await registerAgent("42", "https://0run.fun/coach/42");

    expect(r).toEqual({ error: "timeout" });
  });
});
