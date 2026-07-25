import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _setAgentBookForTest } from "./agentbook";

// vi.hoisted: the mock factory below runs during the hoisted top-level
// `import { checkA2aAdmission } from "./gate"`, before a plain `const`
// would have initialized — vitest's documented fix for that TDZ.
const { tryIncrementMock } = vi.hoisted(() => ({
  tryIncrementMock: vi.fn(async (_endpoint: string, _humanId: string, _limit: number) => true),
}));
vi.mock("./agentkitStorage", () => ({ agentkitStorage: { tryIncrementUsage: tryIncrementMock } }));

import { checkA2aAdmission } from "./gate";

const ADDR = "0x" + "ab".repeat(20);

describe("checkA2aAdmission", () => {
  beforeEach(() => {
    vi.stubEnv("REQUIRE_HUMAN_BACKED_A2A", "1");
    vi.stubEnv("A2A_DAILY_QUOTA_PER_HUMAN", "20");
    tryIncrementMock.mockClear().mockResolvedValue(true);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("registrato e sotto quota → ok con humanId; il contatore è per-humanId con bucket giornaliero", async () => {
    _setAgentBookForTest({ lookupHuman: async () => "0x1234" });
    const res = await checkA2aAdmission(ADDR);
    expect(res).toEqual({ ok: true, humanBacked: { humanId: "0x1234" } });
    const [endpoint, humanId, limit] = tryIncrementMock.mock.calls[0];
    expect(endpoint).toMatch(/^a2a:\d{4}-\d{2}-\d{2}$/);
    expect(humanId).toBe("0x1234");
    expect(limit).toBe(20);
  });

  it("non registrato → 403 human_backing_required con puntatori a registry e registrazione", async () => {
    _setAgentBookForTest({ lookupHuman: async () => null });
    const res = await checkA2aAdmission(ADDR);
    if (res.ok) throw new Error("expected refusal");
    expect(res.response.status).toBe(403);
    const body = await res.response.json();
    expect(body.reason).toBe("human_backing_required");
    expect(body.agentbook.network).toBe("eip155:480");
    expect(body.register).toContain("/mint");
  });

  it("nome senza addr → 403 (nessuno di accountable dietro il nome)", async () => {
    _setAgentBookForTest({ lookupHuman: async () => "0x1234" });
    const res = await checkA2aAdmission(null);
    if (res.ok) throw new Error("expected refusal");
    expect(res.response.status).toBe(403);
  });

  it("lookup non disponibile → 503, mai 403 (unknown non è un no)", async () => {
    _setAgentBookForTest({
      lookupHuman: async () => {
        throw new Error("rpc down");
      },
    });
    const res = await checkA2aAdmission(ADDR);
    if (res.ok) throw new Error("expected refusal");
    expect(res.response.status).toBe(503);
  });

  it("quota esaurita → 429 con humanId", async () => {
    _setAgentBookForTest({ lookupHuman: async () => "0x1234" });
    tryIncrementMock.mockResolvedValueOnce(false);
    const res = await checkA2aAdmission(ADDR);
    if (res.ok) throw new Error("expected refusal");
    expect(res.response.status).toBe(429);
    expect((await res.response.json()).humanId).toBe("0x1234");
  });

  it("flag spento → sempre ok; humanBacked riportato best-effort, contatore mai toccato", async () => {
    vi.stubEnv("REQUIRE_HUMAN_BACKED_A2A", "");
    _setAgentBookForTest({ lookupHuman: async () => "0x1234" });
    expect(await checkA2aAdmission(ADDR)).toEqual({ ok: true, humanBacked: { humanId: "0x1234" } });
    _setAgentBookForTest({ lookupHuman: async () => null });
    expect(await checkA2aAdmission(ADDR)).toEqual({ ok: true, humanBacked: null });
    expect(tryIncrementMock).not.toHaveBeenCalled();
  });
});
