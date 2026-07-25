import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoachProfile, RunStats } from "@0run/shared";

const profile: CoachProfile = {
  version: 1, name: "K", personality: "coach",
  totals: { runs: 3, km: 15 }, paceTrend: [300, 295, 290], styleNotes: "Balanced professional",
};
const current: RunStats = {
  distanceKm: 5, durationSec: 1500, avgPaceSecKm: 300, elevationGainM: 40,
  splitsSecKm: [300, 298, 302, 301, 299], avgHr: 150, startedAt: "2026-07-20T07:30:00.000Z",
};

// scoreRun is the ONE call in the product that must always take the
// TEE-attested "direct" 0G Compute path — never the router — regardless of
// INFERENCE_PREFER, because the score is the disputable/gameable part where
// tamper-proof provenance matters (docs/0g-reality-check.md, "Router contro
// Direct"). Every test here mocks ../inference/direct directly, at the same
// relative path score.ts imports it from.
describe("scoreRun", () => {
  afterEach(() => {
    vi.doUnmock("../inference/direct");
    vi.doUnmock("../inference");
    vi.resetModules();
  });

  it("JSON valido → score e note parsati, verified/model propagati dal path direct", async () => {
    vi.doMock("../inference/direct", () => ({
      directComplete: vi.fn(async () => ({
        text: '{"score":4,"note":"sforzo alto rispetto alla tua media recente"}',
        verified: true, model: "qwen2.5-omni-7b", path: "direct" as const,
      })),
    }));
    vi.resetModules();
    const { scoreRun } = await import("./score");
    const out = await scoreRun(profile, [], current);
    expect(out).toEqual({
      ok: true, score: 4, note: "sforzo alto rispetto alla tua media recente",
      verified: true, model: "qwen2.5-omni-7b",
    });
  });

  it("score fuori range (9) → rifiutato, MAI clampato: esito unavailable", async () => {
    vi.doMock("../inference/direct", () => ({
      directComplete: vi.fn(async () => ({
        text: '{"score":9,"note":"esagerato"}', verified: true, model: "qwen2.5-omni-7b", path: "direct" as const,
      })),
    }));
    vi.resetModules();
    const { scoreRun } = await import("./score");
    const out = await scoreRun(profile, [], current);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBeTruthy();
  });

  it("il path direct lancia (provider giù) → esito unavailable, MAI un throw", async () => {
    vi.doMock("../inference/direct", () => ({
      directComplete: vi.fn(async () => { throw new Error("direct: tutti i provider falliti"); }),
    }));
    vi.resetModules();
    const { scoreRun } = await import("./score");
    await expect(scoreRun(profile, [], current)).resolves.toMatchObject({ ok: false });
  });

  it("non chiama mai coachComplete: il path attestato non è aggirabile da INFERENCE_PREFER", async () => {
    vi.doMock("../inference/direct", () => ({
      directComplete: vi.fn(async () => ({
        text: '{"score":3,"note":"ok"}', verified: false, model: "qwen2.5-omni-7b", path: "direct" as const,
      })),
    }));
    const coachCompleteMock = vi.fn();
    vi.doMock("../inference", async (orig) => ({
      ...(await orig() as object),
      coachComplete: coachCompleteMock,
    }));
    vi.resetModules();
    const { scoreRun } = await import("./score");
    await scoreRun(profile, [], current);
    expect(coachCompleteMock).not.toHaveBeenCalled();
  });
});
