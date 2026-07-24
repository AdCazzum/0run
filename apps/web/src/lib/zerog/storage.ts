import { Indexer, MemData } from "@0gfoundation/0g-storage-ts-sdk";
import { ethers } from "ethers";
import { GALILEO, type StorageReceipt } from "@0run/shared";

type Deps = {
  makeData: (bytes: Uint8Array) => Promise<{ data: unknown; rootHash: string }>;
  doUpload: (data: unknown, key: Buffer) => Promise<readonly [string | null, Error | null]>;
  doDownload: (rootHash: string, key: Buffer) => Promise<Buffer>;
};

function realDeps(): Deps {
  const provider = new ethers.JsonRpcProvider(process.env.ZG_RPC_URL ?? GALILEO.rpcUrl);
  const signer = new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY!, provider);
  const indexer = new Indexer(process.env.ZG_INDEXER_URL ?? GALILEO.indexerUrl);
  return {
    makeData: async (bytes) => {
      const data = new MemData(bytes);
      const [tree, err] = await data.merkleTree();
      if (err || !tree) throw err ?? new Error("merkle tree failed");
      return { data, rootHash: tree.rootHash()! };
    },
    doUpload: async (data, key) => {
      // SDK's Indexer.upload() returns [{ txHash, rootHash, txSeq } | { txHashes, rootHashes, txSeqs }, Error | null] —
      // not a bare [txHash, Error] tuple as sketched in the brief. Extract txHash here.
      const [result, err] = await indexer.upload(data as MemData, process.env.ZG_RPC_URL ?? GALILEO.rpcUrl, signer, {
        encryption: { type: "aes256", key },
      });
      if (err || !result) return [null, err ?? new Error("upload failed")] as const;
      const txHash = "txHash" in result ? result.txHash : result.txHashes[0];
      return [txHash, null] as const;
    },
    doDownload: async (rootHash, key) => {
      // SDK's Indexer.downloadToBlob() returns [Blob, Error | null], not a bare Promise<Blob>.
      const [blob, err] = await indexer.downloadToBlob(rootHash, { decryption: { symmetricKey: key } });
      if (err || !blob) throw err ?? new Error("download failed");
      return Buffer.from(await blob.arrayBuffer());
    },
  };
}

let deps: Deps | null = null;
const getDeps = () => (deps ??= realDeps());
export function _setDepsForTest(d: Deps) { deps = d; }

export async function uploadEncrypted(bytes: Uint8Array, key: Buffer): Promise<StorageReceipt> {
  try {
    const { data, rootHash } = await getDeps().makeData(bytes);
    let lastErr = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const [tx, err] = await getDeps().doUpload(data, key);
      if (!err && tx) return { ok: true, rootHash, txHash: tx };
      lastErr = String(err);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
    return { ok: false, error: `upload failed after 3 attempts: ${lastErr}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function downloadDecrypted(
  rootHash: string, key: Buffer, validate: (buf: Buffer) => boolean,
): Promise<{ ok: true; data: Buffer } | { ok: false; error: string }> {
  try {
    const buf = await getDeps().doDownload(rootHash, key);
    if (!validate(buf)) return { ok: false, error: "validation failed (chiave sbagliata o dato corrotto)" };
    return { ok: true, data: buf };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
