import { beforeEach, describe, expect, it, vi } from "vitest";
import { _setAgentBookForTest, lookupHumanId, getAgentNonce, agentBookAddress } from "./agentbook";

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

  it("un errore con messaggio vuoto resta un errore: 'if (error)' non deve mancarlo", async () => {
    _setAgentBookForTest({ lookupHuman: vi.fn(async () => { throw new Error(""); }) });
    const r = await lookupHumanId(WALLET);
    expect(r.humanId).toBeNull();
    expect(r.error).toBeTruthy();
  });

  it("mette in cache un esito positivo (una sola chiamata al registro)", async () => {
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

  it("NON mette in cache un 'non registrato': chi si registra e riprova subito deve passare", async () => {
    let registered = false;
    const spy = vi.fn(async () => (registered ? "human_abc" : null));
    _setAgentBookForTest({ lookupHuman: spy });

    expect((await lookupHumanId(WALLET)).humanId).toBeNull();
    registered = true; // l'utente si registra in World App e riprova entro il minuto
    expect((await lookupHumanId(WALLET)).humanId).toBe("human_abc");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("passa al registro un indirizzo in checksum, non la stringa grezza", async () => {
    const spy = vi.fn(async () => "human_abc");
    _setAgentBookForTest({ lookupHuman: spy });
    await lookupHumanId(WALLET.toLowerCase());
    // viem rifiuta un mixed-case con checksum sbagliato: normalizzare a monte è
    // ciò che impedisce a un chiamante di marcare un wallet come "non umano".
    expect(spy).toHaveBeenCalledWith(WALLET);
  });

  it("indirizzo non valido → errore, mai 'non è un umano'", async () => {
    const spy = vi.fn(async () => "human_abc");
    _setAgentBookForTest({ lookupHuman: spy });
    const r = await lookupHumanId("non-un-indirizzo");
    expect(r.humanId).toBeNull();
    expect(r.error).toMatch(/indirizzo non valido/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("un registro che si impianta scade come 'sconosciuto', non blocca il mint", async () => {
    _setAgentBookForTest({ lookupHuman: () => new Promise(() => {}) }); // mai risolta
    const r = await lookupHumanId(WALLET);
    expect(r.humanId).toBeNull();
    expect(r.error).toMatch(/timeout/);
  }, 10_000);
});

describe("getAgentNonce", () => {
  it("nonce dal contratto come stringa decimale", async () => {
    _setAgentBookForTest({ lookupHuman: async () => null, getNextNonce: async () => "3" });
    expect(await getAgentNonce("0x" + "ab".repeat(20))).toEqual({ nonce: "3" });
  });

  it("indirizzo non valido → error, mai un throw", async () => {
    _setAgentBookForTest({ lookupHuman: async () => null, getNextNonce: async () => "0" });
    const res = await getAgentNonce("not-an-address");
    expect("error" in res && res.error.length > 0).toBe(true);
  });

  it("lettura che fallisce → error, mai un throw", async () => {
    _setAgentBookForTest({
      lookupHuman: async () => null,
      getNextNonce: async () => {
        throw new Error("rpc down");
      },
    });
    expect(await getAgentNonce("0x" + "ab".repeat(20))).toEqual({ error: "rpc down" });
  });

  it("WORLD_AGENTBOOK_ADDRESS malformato → error, non throw", async () => {
    vi.stubEnv("WORLD_AGENTBOOK_ADDRESS", "not-an-address");
    _setAgentBookForTest(null); // Força realReader() al prossimo accesso
    const res = await getAgentNonce(WALLET);
    expect("error" in res && res.error.length > 0).toBe(true);
    vi.unstubAllEnvs();
    _setAgentBookForTest(null);
  });
});

describe("agentBookAddress", () => {
  it("default canonico quando l'env non è impostata", () => {
    expect(agentBookAddress()).toBe("0xA23aB2712eA7BBa896930544C7d6636a96b944dA");
  });
});
