import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const topUpIfNeededMock = vi.fn();
const selectWhereMock = vi.fn();
const updateSetMock = vi.fn();
const updateWhereMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: (...args: any[]) => requireUserMock(...args),
}));

vi.mock("@/lib/funder", () => ({
  topUpIfNeeded: (...args: any[]) => topUpIfNeededMock(...args),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (...args: any[]) => selectWhereMock(...args),
      }),
    }),
    update: () => ({
      set: (...args: any[]) => {
        updateSetMock(...args);
        return { where: (...args2: any[]) => updateWhereMock(...args2) };
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

  it("under cap + funded:true -> 200 and increments fundedCount", async () => {
    selectWhereMock.mockResolvedValue([{ id: 1, fundedCount: 0 }]);
    topUpIfNeededMock.mockResolvedValue({ funded: true, txHash: "0xtx" });

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ funded: true, txHash: "0xtx" });
    expect(topUpIfNeededMock).toHaveBeenCalledWith(WALLET);
    expect(updateSetMock).toHaveBeenCalledTimes(1);
    expect(updateWhereMock).toHaveBeenCalledTimes(1);
  });

  it("under cap + funded:false (already has gas) -> 200, no increment", async () => {
    selectWhereMock.mockResolvedValue([{ id: 1, fundedCount: 1 }]);
    topUpIfNeededMock.mockResolvedValue({ funded: false });

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ funded: false });
    expect(topUpIfNeededMock).toHaveBeenCalledWith(WALLET);
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it("at cap -> 429 and topUpIfNeeded NOT called", async () => {
    selectWhereMock.mockResolvedValue([{ id: 1, fundedCount: 3 }]);

    const res = await POST(req());

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "funding cap reached" });
    expect(topUpIfNeededMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
  });
});
