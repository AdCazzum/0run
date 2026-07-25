import { describe, expect, it, vi } from "vitest";
import { uploadEncrypted, downloadDecrypted, prepareEncryptedUpload, _setDepsForTest } from "./storage";

describe("storage receipts", () => {
  it("upload ok → receipt con rootHash e txHash", async () => {
    _setDepsForTest({
      makeData: async () => ({ data: {}, rootHash: "0xroot" }),
      doUpload: vi.fn(async () => ["0xtx", null] as const),
      doDownload: async () => Buffer.from("x"),
    });
    const r = await uploadEncrypted(new Uint8Array([1]), Buffer.alloc(32));
    expect(r).toEqual({ ok: true, rootHash: "0xroot", txHash: "0xtx" });
  });
  it("upload che fallisce 3 volte → receipt ok:false, MAI throw", async () => {
    const doUpload = vi.fn(async () => [null, new Error("indexer 503")] as const);
    _setDepsForTest({ makeData: async () => ({ data: {}, rootHash: "0xroot" }), doUpload, doDownload: async () => Buffer.from("x") });
    const r = await uploadEncrypted(new Uint8Array([1]), Buffer.alloc(32));
    expect(r.ok).toBe(false);
    expect(doUpload).toHaveBeenCalledTimes(3);
  });
  it("download con validate che fallisce → ok:false (chiave sbagliata = garbage silenzioso)", async () => {
    _setDepsForTest({
      makeData: async () => ({ data: {}, rootHash: "0xroot" }),
      doUpload: async () => ["0xtx", null] as const,
      doDownload: async () => Buffer.from("garbage"),
    });
    const r = await downloadDecrypted("0xroot", Buffer.alloc(32), () => false);
    expect(r.ok).toBe(false);
  });
  it("upload il cui doUpload non risolve mai → ok:false per timeout (mai un hang), senza attendere il budget reale", async () => {
    vi.useFakeTimers();
    try {
      _setDepsForTest({
        makeData: async () => ({ data: {}, rootHash: "0xroot" }),
        doUpload: () => new Promise<readonly [string | null, Error | null]>(() => {}), // non risolve mai, come misurato in rete reale
        doDownload: async () => Buffer.from("x"),
        uploadTimeoutMs: 10, // budget minuscolo per il test: 3 tentativi * 10ms + backoff (2s+4s+6s) di tempo fittizio
      });
      const pending = uploadEncrypted(new Uint8Array([1]), Buffer.alloc(32));
      // Avanza abbastanza tempo fittizio da coprire i 3 tentativi con timeout + tutti i backoff.
      await vi.advanceTimersByTimeAsync(20_000);
      const r = await pending;
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toMatch(/timed out/i);
        expect(r.error).toMatch(/may still have landed/i);
      }
    } finally {
      vi.useRealTimers();
    }
  });
  it("download il cui doDownload non risolve mai → ok:false per timeout (mai un hang)", async () => {
    _setDepsForTest({
      makeData: async () => ({ data: {}, rootHash: "0xroot" }),
      doUpload: async () => ["0xtx", null] as const,
      doDownload: () => new Promise<Buffer>(() => {}), // non risolve mai
      downloadTimeoutMs: 10,
    });
    const r = await downloadDecrypted("0xroot", Buffer.alloc(32), () => true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/timed out/i);
  });
});

describe("prepareEncryptedUpload", () => {
  it("ritorna rootHash senza mai chiamare doUpload", async () => {
    const doUpload = vi.fn(async () => ["0xtx", null] as const);
    _setDepsForTest({
      makeData: async () => ({ data: {}, rootHash: "0xroot" }),
      doUpload,
      doDownload: async () => Buffer.from("x"),
    });
    const { rootHash, upload } = await prepareEncryptedUpload(new Uint8Array([1]), Buffer.alloc(32));
    expect(rootHash).toBe("0xroot");
    expect(doUpload).not.toHaveBeenCalled();
    expect(typeof upload).toBe("function");
  });

  it("upload() esegue il retry e ritorna la receipt, solo quando invocato", async () => {
    const doUpload = vi.fn(async () => ["0xtx", null] as const);
    _setDepsForTest({
      makeData: async () => ({ data: {}, rootHash: "0xroot" }),
      doUpload,
      doDownload: async () => Buffer.from("x"),
    });
    const { upload } = await prepareEncryptedUpload(new Uint8Array([1]), Buffer.alloc(32));
    expect(doUpload).not.toHaveBeenCalled();
    const r = await upload();
    expect(r).toEqual({ ok: true, rootHash: "0xroot", txHash: "0xtx" });
    expect(doUpload).toHaveBeenCalledTimes(1);
  });

  it("upload() che fallisce 3 volte → receipt ok:false, MAI throw (stesso contratto di uploadEncrypted)", async () => {
    const doUpload = vi.fn(async () => [null, new Error("indexer 503")] as const);
    _setDepsForTest({ makeData: async () => ({ data: {}, rootHash: "0xroot" }), doUpload, doDownload: async () => Buffer.from("x") });
    const { upload } = await prepareEncryptedUpload(new Uint8Array([1]), Buffer.alloc(32));
    const r = await upload();
    expect(r.ok).toBe(false);
    expect(doUpload).toHaveBeenCalledTimes(3);
  });
});
