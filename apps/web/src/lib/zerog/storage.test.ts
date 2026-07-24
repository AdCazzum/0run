import { describe, expect, it, vi } from "vitest";
import { uploadEncrypted, downloadDecrypted, _setDepsForTest } from "./storage";

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
});
