import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// One coach on-chain (tokenId "3") with a DB row that has NO ens_name — the
// exact production state that hid a live ENS identity behind a lost write.
const CONTRACT = "0x3df1e8029ce2360ABdfECD0fcc966B04F76eaf9e";
const OWNER = "0x7AEa10Ebc47CC8F2eb359B2e19a6286Ef36A59e6";
let coachRows: any[] = [];

vi.mock("@/db", () => ({
  db: {
    select: (projection?: any) => ({
      from: () => {
        // count() query for runs — anything with a projection is the run count
        if (projection) return { where: () => [{ value: 2 }] };
        return coachRows;
      },
    }),
  },
}));

vi.mock("ethers", () => ({
  ethers: {
    JsonRpcProvider: class {},
    Contract: class {
      async nextId() {
        return 4n; // tokenIds 1..3 exist
      }
      async ownerOf(id: number) {
        if (id !== 3) throw new Error("nonexistent token");
        return OWNER;
      }
    },
  },
}));

const resolveCoachEns = vi.fn();
vi.mock("@/lib/ens/resolve", () => ({ resolveCoachEns: (name: string) => resolveCoachEns(name) }));

import { _resetDirectoryCacheForTest, getCoachDirectory } from "./directory";

const records = (tokenId: string, contract = CONTRACT) => ({
  "0run:inft": `16602:${contract}:${tokenId}`,
});

beforeEach(() => {
  _resetDirectoryCacheForTest();
  resolveCoachEns.mockReset();
  process.env.AGENT_NFT_ADDRESS = CONTRACT;
  process.env.ENS_PARENT_NAME = "0run.eth";
  coachRows = [{ tokenId: "3", userId: 1, name: "Pedro", personality: "drill_sergeant", ensName: null }];
});

afterEach(() => _resetDirectoryCacheForTest());

describe("getCoachDirectory — recupero del nome ENS perso", () => {
  it("ritrova pedro.0run.eth dal nome del coach quando la colonna in DB è vuota", async () => {
    resolveCoachEns.mockResolvedValue({ address: OWNER, records: records("3") });

    const [entry] = await getCoachDirectory();

    expect(resolveCoachEns).toHaveBeenCalledWith("pedro.0run.eth");
    expect(entry.ensName).toBe("pedro.0run.eth");
    expect(entry.displayName).toBe("pedro.0run.eth");
    expect(entry.mismatch).toBe(false);
  });

  it("scarta un nome che risolve ma punta a un ALTRO token: non è la sua identità", async () => {
    resolveCoachEns.mockResolvedValue({ address: OWNER, records: records("9") });

    const [entry] = await getCoachDirectory();

    expect(entry.ensName).toBeNull();
    expect(entry.displayName).toBeNull();
  });

  it("scarta un nome che punta a un altro contratto", async () => {
    resolveCoachEns.mockResolvedValue({
      address: OWNER,
      records: records("3", "0x000000000000000000000000000000000000dEaD"),
    });

    const [entry] = await getCoachDirectory();
    expect(entry.displayName).toBeNull();
  });

  it("senza record 0run:inft non c'è prova: il nome indovinato non viene mostrato", async () => {
    resolveCoachEns.mockResolvedValue({ address: OWNER, records: {} });

    const [entry] = await getCoachDirectory();
    expect(entry.displayName).toBeNull();
  });

  it("se il nome non risolve, l'agente resta senza identità (mai un nome inventato)", async () => {
    resolveCoachEns.mockResolvedValue({ address: null, records: {} });

    const [entry] = await getCoachDirectory();
    expect(entry.displayName).toBeNull();
    expect(entry.tokenId).toBe("3"); // l'agente esiste comunque: la catena lo dice
  });

  it("un nome registrato in DB è usato tal quale, senza indovinare", async () => {
    coachRows = [{ tokenId: "3", userId: 1, name: "Pedro", personality: "pacer", ensName: "custom.0run.eth" }];
    resolveCoachEns.mockResolvedValue({ address: OWNER, records: records("3") });

    const [entry] = await getCoachDirectory();

    expect(resolveCoachEns).toHaveBeenCalledTimes(1);
    expect(resolveCoachEns).toHaveBeenCalledWith("custom.0run.eth");
    expect(entry.displayName).toBe("custom.0run.eth");
  });

  it("un agente senza riga in DB non fa partire nessun tentativo di recupero", async () => {
    coachRows = [];

    const [entry] = await getCoachDirectory();

    expect(resolveCoachEns).not.toHaveBeenCalled();
    expect(entry.displayName).toBeNull();
    expect(entry.personality).toBeNull();
  });
});
