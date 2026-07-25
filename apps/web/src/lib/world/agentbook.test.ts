import { beforeEach, describe, expect, it, vi } from "vitest";
import { _setAgentBookForTest, lookupHumanId } from "./agentbook";

const WALLET = "0x7AEa10Ebc47CC8F2eb359B2e19a6286Ef36A59e6";

describe("lookupHumanId", () => {
  beforeEach(() => _setAgentBookForTest(null));

  it("restituisce l'humanId di un wallet registrato", async () => {
    _setAgentBookForTest({ lookupHuman: vi.fn(async () => "human_abc") });
    expect(await lookupHumanId(WALLET)).toEqual({ humanId: "human_abc" });
  });

  it("wallet non registrato → humanId null SENZA errore (assenza accertata)", async () => {
    _setAgentBookForTest({ lookupHuman: vi.fn(async () => null) });
    const r = await lookupHumanId(WALLET);
    expect(r.humanId).toBeNull();
    expect(r.error).toBeUndefined();
  });

  it("registro irraggiungibile → null CON errore: 'sconosciuto', non 'non umano'", async () => {
    _setAgentBookForTest({ lookupHuman: vi.fn(async () => { throw new Error("RPC down"); }) });
    const r = await lookupHumanId(WALLET);
    expect(r.humanId).toBeNull();
    expect(r.error).toMatch(/RPC down/);
  });

  it("non lancia mai, qualunque cosa faccia il registro", async () => {
    _setAgentBookForTest({ lookupHuman: vi.fn(async () => { throw "stringa nuda"; }) });
    await expect(lookupHumanId(WALLET)).resolves.toBeTruthy();
  });

  it("mette in cache un esito accertato (una sola chiamata al registro)", async () => {
    const spy = vi.fn(async () => "human_abc");
    _setAgentBookForTest({ lookupHuman: spy });
    await lookupHumanId(WALLET);
    await lookupHumanId(WALLET.toLowerCase()); // stesso wallet, forma diversa
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("NON mette in cache un errore: un guasto passeggero non blocca il wallet per un minuto", async () => {
    const spy = vi.fn(async () => { throw new Error("RPC down"); });
    _setAgentBookForTest({ lookupHuman: spy });
    await lookupHumanId(WALLET);
    await lookupHumanId(WALLET);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
