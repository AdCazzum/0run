import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashSignal } from "@worldcoin/idkit/hashing";

process.env.WORLD_RP_ID = "rp_test1234567890";

const SIGNAL = "1:0x2222222222222222222222222222222222222222";
const SIGNAL_HASH = hashSignal(SIGNAL);

function idkitResult(overrides: Partial<{ signal_hash: string; nullifier: string; identifier: string }> = {}) {
  return {
    protocol_version: "4.0",
    nonce: "n",
    action: "claim-run-event",
    responses: [
      {
        identifier: overrides.identifier ?? "proof_of_human",
        proof: ["0xa1", "0xa2", "0xa3", "0xa4", "0xa5"],
        nullifier: overrides.nullifier ?? "0xnullifier",
        issuer_schema_id: 1,
        expires_at_min: 0,
        signal_hash: overrides.signal_hash ?? SIGNAL_HASH,
      },
    ],
    user_presence_completed: false,
    environment: "production",
  };
}

describe("verifyWorldProof", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("success === true → ok con nullifier e level", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) })));
    const { verifyWorldProof } = await import("./verify");
    const r = await verifyWorldProof(idkitResult() as never, SIGNAL);
    expect(r).toEqual({ ok: true, nullifierHash: "0xnullifier", level: "proof_of_human" });
  });

  it("risposta SENZA campo success → ok:false (check strict, mai lasco)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    const { verifyWorldProof } = await import("./verify");
    expect((await verifyWorldProof(idkitResult() as never, SIGNAL)).ok).toBe(false);
  });

  it("success con valore diverso da true (es. stringa 'true') → ok:false", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: "true" }) })));
    const { verifyWorldProof } = await import("./verify");
    expect((await verifyWorldProof(idkitResult() as never, SIGNAL)).ok).toBe(false);
  });

  it("HTTP non-2xx → ok:false, nessun throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ code: "invalid_proof" }) })));
    const { verifyWorldProof } = await import("./verify");
    const r = await verifyWorldProof(idkitResult() as never, SIGNAL);
    expect(r.ok).toBe(false);
  });

  it("fetch che lancia (rete giù) → ok:false, nessun throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const { verifyWorldProof } = await import("./verify");
    const r = await verifyWorldProof(idkitResult() as never, SIGNAL);
    expect(r.ok).toBe(false);
  });

  it("signal_hash della proof diverso da quello atteso → rifiutata PRIMA della chiamata cloud-verify (signal binding)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { verifyWorldProof } = await import("./verify");
    const r = await verifyWorldProof(idkitResult({ signal_hash: "0xdeadbeef" }) as never, SIGNAL);
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("WORLD_RP_ID non configurato → ok:false, nessuna chiamata di rete", async () => {
    const saved = process.env.WORLD_RP_ID;
    delete process.env.WORLD_RP_ID;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { verifyWorldProof } = await import("./verify");
      const r = await verifyWorldProof(idkitResult() as never, SIGNAL);
      expect(r.ok).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      process.env.WORLD_RP_ID = saved;
    }
  });

  it("non logga mai la proof (né su success né su failure)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) })));
    const { verifyWorldProof } = await import("./verify");
    await verifyWorldProof(idkitResult() as never, SIGNAL);
    await verifyWorldProof(idkitResult({ signal_hash: "0xnope" }) as never, SIGNAL);
    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().join(" ");
    expect(logged).not.toContain("0xa1");
    expect(logged).not.toContain(SIGNAL_HASH);
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
