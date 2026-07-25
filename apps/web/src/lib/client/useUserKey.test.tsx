// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const wallet = vi.hoisted(() => ({ address: "0xAAA" }));
const signMessage = vi.hoisted(() => vi.fn());
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ user: wallet.address ? { wallet: { address: wallet.address } } : null }),
  useSignMessage: () => ({ signMessage }),
}));

import { _resetUserKeyCacheForTest, forgetUserKey, useUserKey } from "./useUserKey";

beforeEach(() => {
  _resetUserKeyCacheForTest();
  wallet.address = "0xAAA";
  signMessage.mockReset().mockResolvedValue({ signature: "0x" + "11".repeat(65) });
});
afterEach(() => _resetUserKeyCacheForTest());

const hook = () => renderHook(() => useUserKey()).result.current;

describe("useUserKey", () => {
  it("deriva una chiave di 32 byte dalla firma", async () => {
    const keyHex = await hook().getKeyHex();
    expect(keyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("due componenti diversi condividono UNA firma sola", async () => {
    // Il bug vero: la cache era per componente, quindi la pagina della corsa e
    // la sua chat chiedevano una firma ciascuna.
    const [a, b] = [hook(), hook()];
    await a.getKeyHex();
    await b.getKeyHex();
    expect(signMessage).toHaveBeenCalledTimes(1);
  });

  it("richieste CONCORRENTI non aprono due firme (è ciò che manda Privy in errore)", async () => {
    const a = hook();
    const b = hook();
    const [first, second] = await Promise.all([a.getKeyHex(), b.getKeyHex()]);
    expect(signMessage).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("non mostra il modale: questa firma non è una decisione da prendere", async () => {
    await hook().getKeyHex();
    expect(signMessage).toHaveBeenCalledWith(expect.objectContaining({ message: expect.any(String) }), {
      uiOptions: { showWalletUIs: false },
    });
  });

  it("un altro wallet ottiene la SUA chiave, mai quella di prima", async () => {
    const first = await hook().getKeyHex();
    signMessage.mockResolvedValue({ signature: "0x" + "22".repeat(65) });
    wallet.address = "0xBBB";
    const second = await hook().getKeyHex();
    expect(second).not.toBe(first);
    expect(signMessage).toHaveBeenCalledTimes(2);
  });

  it("dopo il logout la chiave non resta in memoria per il prossimo", async () => {
    await hook().getKeyHex();
    forgetUserKey();
    await hook().getKeyHex();
    expect(signMessage).toHaveBeenCalledTimes(2);
  });

  it("senza wallet pronto dice cosa fare, non firma nel vuoto", async () => {
    wallet.address = "";
    await expect(hook().getKeyHex()).rejects.toThrow(/wallet non pronto/);
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("una firma rifiutata non viene messa in cache: il tentativo dopo riprova", async () => {
    signMessage.mockRejectedValueOnce(new Error("user rejected"));
    await expect(hook().getKeyHex()).rejects.toThrow(/user rejected/);
    signMessage.mockResolvedValue({ signature: "0x" + "33".repeat(65) });
    expect(await hook().getKeyHex()).toMatch(/^[0-9a-f]{64}$/);
  });
});
