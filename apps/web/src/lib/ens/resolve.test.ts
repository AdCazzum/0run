import { beforeEach, describe, expect, it } from "vitest";
import { _setClientForTest, resolveCoachEns } from "./resolve";

describe("resolveCoachEns", () => {
  beforeEach(() => {
    process.env.ENS_SEPOLIA_RPC = "https://example.invalid";
  });

  it("nome esistente → address + text record ENSIP-26 e 0run:inft", async () => {
    _setClientForTest({
      getEnsAddress: (async () => "0xabc0000000000000000000000000000000abc0") as any,
      getEnsText: (async ({ key }: { key: string }) => {
        const values: Record<string, string> = {
          "agent-context": "0run coach agent",
          "agent-endpoint[web]": "https://0run.fun/coach/1",
          "0run:inft": "16602:0xnft:1",
        };
        return values[key] ?? null;
      }) as any,
    });

    const r = await resolveCoachEns("pedro.0run.eth");

    expect(r).toEqual({
      address: "0xabc0000000000000000000000000000000abc0",
      records: {
        "agent-context": "0run coach agent",
        "agent-endpoint[web]": "https://0run.fun/coach/1",
        "0run:inft": "16602:0xnft:1",
      },
    });
  });

  it("nome inesistente → {address: null, records: {}} senza throw", async () => {
    _setClientForTest({
      getEnsAddress: (async () => null) as any,
      getEnsText: (async () => null) as any,
    });

    const r = await resolveCoachEns("nobody-registered-this.0run.eth");

    expect(r).toEqual({ address: null, records: {} });
  });

  it("il client rifiuta (RPC down / resolver revert) → risultato vuoto, MAI un valore hard-coded", async () => {
    _setClientForTest({
      getEnsAddress: (async () => { throw new Error("rpc down"); }) as any,
      getEnsText: (async () => { throw new Error("rpc down"); }) as any,
    });

    await expect(resolveCoachEns("pedro.0run.eth")).resolves.toEqual({ address: null, records: {} });
  });

  it("ENS_SEPOLIA_RPC assente → risultato vuoto senza throw (nessun client costruibile)", async () => {
    delete process.env.ENS_SEPOLIA_RPC;
    _setClientForTest(null); // forza realClient() a essere richiamata e a fallire per env mancante

    await expect(resolveCoachEns("pedro.0run.eth")).resolves.toEqual({ address: null, records: {} });
  });
});
