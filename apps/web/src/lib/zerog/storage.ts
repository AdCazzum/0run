import { Indexer, MemData, EncryptedFile, newSymmetricEncryptedFile } from "@0gfoundation/0g-storage-ts-sdk";
import { ethers } from "ethers";
import { GALILEO, type StorageReceipt } from "@0run/shared";

type Deps = {
  makeData: (bytes: Uint8Array, key: Buffer) => Promise<{ data: unknown; rootHash: string }>;
  doUpload: (data: unknown, key: Buffer) => Promise<readonly [string | null, Error | null]>;
  doDownload: (rootHash: string, key: Buffer) => Promise<Buffer>;
};

function realDeps(): Deps {
  const provider = new ethers.JsonRpcProvider(process.env.ZG_RPC_URL ?? GALILEO.rpcUrl);
  const signer = new ethers.Wallet(process.env.TREASURY_PRIVATE_KEY!, provider);
  const indexer = new Indexer(process.env.ZG_INDEXER_URL ?? GALILEO.indexerUrl);
  return {
    makeData: async (bytes, key) => {
      // Wrap the plaintext ourselves with the SDK's OWN encryption helper and
      // compute the Merkle root over the WRAPPED stream, not the plaintext.
      //
      // Why: Uploader.uploadFile() wraps the file in encryption BEFORE
      // computing its Merkle tree — `if (mergedOpts.encryption) file =
      // this.wrapEncryption(file, ...)` then `file.merkleTree()`
      // (node_modules/@0gfoundation/0g-storage-ts-sdk/lib.esm/transfer/Uploader.js:24-34).
      // wrapEncryption() prepends a 17-byte header containing a FRESH RANDOM
      // 16-byte nonce (common/encryption.js newSymmetricHeader() ->
      // randomBytes(16)) and AES-256-CTR-encrypts the body. So a rootHash
      // computed over plaintext (the old code) can never match what the SDK
      // actually submits, and — because the nonce is re-rolled every call —
      // not even the SDK's own result would be stable across retries.
      //
      // Fix: wrap here via the SDK's own exported `newSymmetricEncryptedFile`
      // (lib.esm/file/EncryptedFile.js:91-95, re-exported from the package
      // root through file/index.js -> index.js), compute the root over THAT
      // object, and hand the already-wrapped object to doUpload below —
      // which must NOT pass `uploadOpts.encryption` again, or Uploader would
      // wrap it a second time with yet another random nonce and desync the
      // rootHash we already committed to.
      //
      // Download-side consistency: Indexer.downloadToBlob's decryption path
      // (lib.esm/indexer/Indexer.js:283-299 -> indexer/decryption.js
      // tryDecrypt) works purely off the wire format — parseEncryptionHeader
      // + resolveDecryptionKey + decryptFile (common/encryption.js) — with no
      // dependency on which code path produced the bytes. Since
      // EncryptedFile.readFromFile (lib.esm/file/EncryptedFile.js:23-52) is
      // exactly what the Uploader reads segments from when uploading, the
      // bytes landing on the network are byte-identical to what
      // newSymmetricEncryptedFile(...).readFromFile(0, size) would produce,
      // which is precisely the format tryDecrypt/decryptFile expect. So
      // downloadDecrypted(rootHash, { decryption: { symmetricKey: key } })
      // still round-trips to the original plaintext.
      const encrypted = newSymmetricEncryptedFile(new MemData(bytes), key);
      const [tree, err] = await encrypted.merkleTree();
      if (err || !tree) throw err ?? new Error("merkle tree failed");
      return { data: encrypted, rootHash: tree.rootHash()! };
    },
    doUpload: async (data, _key) => {
      // `data` is already the SDK-wrapped EncryptedFile from makeData above.
      // Do NOT pass `uploadOpts.encryption` here — see the comment in
      // makeData for why a second wrap would desync the rootHash.
      //
      // SDK's Indexer.upload() returns [{ txHash, rootHash, txSeq } | { txHashes, rootHashes, txSeqs }, Error | null] —
      // not a bare [txHash, Error] tuple as sketched in the brief. Extract txHash here.
      const [result, err] = await indexer.upload(
        data as EncryptedFile,
        process.env.ZG_RPC_URL ?? GALILEO.rpcUrl,
        signer,
      );
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
    const { data, rootHash } = await getDeps().makeData(bytes, key);
    let lastErr = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const [tx, err] = await getDeps().doUpload(data, key);
      if (!err) {
        // SDK default `skipIfFinalized: true`: if this exact encrypted
        // stream is already finalized on the network, Uploader.uploadFile()
        // short-circuits and returns { txHash: '', rootHash, txSeq } with
        // err === null (Uploader.js:39-42) — that's success, not a
        // retryable failure. An empty txHash just means "no new tx was
        // needed"; represent that honestly rather than pretending a real
        // tx hash exists.
        return { ok: true, rootHash, txHash: tx || "already-finalized" };
      }
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
