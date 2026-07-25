import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const topUpIfNeededMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();
const updateReturningMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: (...args: any[]) => requireUserMock(...args),
}));

vi.mock("@/lib/funder", () => ({
  topUpIfNeeded: (...args: any[]) => topUpIfNeededMock(...args),
}));

vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (...setArgs: any[]) => {
        updateSetMock(...setArgs);
        return {
          where: (...whereArgs: any[]) => {
            updateWhereMock(...whereArgs);
            return { returning: (...returningArgs: any[]) => updateReturningMock(...returningArgs) };
          },
        };
      },
    }),
  },
}));

const { POST } = await import("./route");

const WALLET = "0x" + "11".repeat(20);

function req() {
  return new Request("http://localhost/api/fund", { method: "POST" });
}

describe("POST /api/fund", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserMock.mockResolvedValue({ userId: 1, wallet: WALLET, privyDid: "did:test:1" });
  });

  it("reserve ok + funded:true -> 200, no decrement", async () => {
    updateReturningMock.mockResolvedValueOnce([{ fundedCount: 1 }]); // reserve succeeds
    topUpIfNeededMock.mockResolvedValue({ funded: true, txHash: "0xtx" });

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ funded: true, txHash: "0xtx" });
    expect(topUpIfNeededMock).toHaveBeenCalledWith(WALLET);
    // only the reserve update happened, no compensating decrement
    expect(updateSetMock).toHaveBeenCalledTimes(1);
  });

  it("reserve ok + funded:false -> 200, decrement called", async () => {
    updateReturningMock.mockResolvedValueOnce([{ fundedCount: 1 }]); // reserve succeeds
    // the compensating decrement doesn't chain .returning() in the route, so
    // updateReturningMock is only ever consumed once (by the reserve call).
    topUpIfNeededMock.mockResolvedValue({ funded: false });

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ funded: false });
    expect(topUpIfNeededMock).toHaveBeenCalledWith(WALLET);
    // reserve update + compensating decrement update
    expect(updateSetMock).toHaveBeenCalledTimes(2);
    expect(updateWhereMock).toHaveBeenCalledTimes(2);
  });

  it("reserve returns [] -> 429, topUpIfNeeded not called", async () => {
    updateReturningMock.mockResolvedValueOnce([]); // cap reached, reserve fails

    const res = await POST(req());

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "funding cap reached" });
    expect(topUpIfNeededMock).not.toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledTimes(1); // only the failed reserve attempt
  });

  it("reserve ok + topUpIfNeeded throws -> 502, no decrement", async () => {
    updateReturningMock.mockResolvedValueOnce([{ fundedCount: 1 }]); // reserve succeeds
    topUpIfNeededMock.mockRejectedValue(new Error("rpc timeout"));

    const res = await POST(req());

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "rpc timeout" });
    // only the reserve update; slot is conservatively burned, no decrement
    expect(updateSetMock).toHaveBeenCalledTimes(1);
  });
});
