import { createPublicClient, http, namehash } from "viem";
import { sepolia } from "viem/chains";
import { ethers } from "ethers";
import { GALILEO } from "@0run/shared";

export type AssignSubnameRecords = {
  tokenId: string;
  endpoint: string;
  avatar: string;
  a2aEndpoint: string;
  // Address of A2A_SIGNER_PRIVATE_KEY, or null when that env is unset — the
  // record is simply skipped then; the coach still mints and resolves.
  signer: string | null;
  /** ENSIP-5 `description`: one line, for the clients that show it. */
  description: string;
  /** ENSIP-5 `url`: same destination as agent-endpoint[web], under the key every client reads. */
  url: string;
  /** `0run:personality`: pacer | coach | drill_sergeant. */
  personality: string;
};
type Result = { name: string; txHash: string } | { error: string };

/**
 * Coach display names are free text ("Kilian!", "夜 Run"); ENS labels are not.
 * Lowercases, keeps only ASCII letters/digits/hyphens, collapses/trims
 * hyphens, and falls back to `coach-<tokenId>` if nothing usable survives —
 * so every mint gets a normalizable label instead of assignSubname silently
 * producing an unresolvable name.
 */
export function slugifyLabel(name: string, tokenId: string): string {
  const DIACRITICS = /[̀-ͯ]/g; // combining marks left behind by NFKD decomposition
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `coach-${tokenId}`;
}

// --- Mechanism, established on-chain (not guessed) ---------------------------
//
// The obvious question for creating `<label>.0run.eth` was: is `0run.eth`
// wrapped in the ENS NameWrapper (-> NameWrapper.setSubnodeRecord) or a plain
// ENSRegistry-owned 2LD (-> ENSRegistry.setSubnodeRecord)? Neither turned out
// to apply. Probing the canonical ENS Registry with Fallback directly
// (`0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`, same address on Sepolia,
// verified by reading a sensible owner for the root node and for "eth" itself)
// via a raw `eth_call` to `owner(namehash("0run.eth"))` and
// `resolver(namehash("0run.eth"))` returns the ZERO ADDRESS for both — i.e.
// "0run.eth" has NO entry at all in the base Registry. So there is no
// Registry-owned node to call `setSubnodeRecord` under, wrapped or not: the
// call would need `msg.sender == owner(node)`, and `owner(node)` is
// `address(0)` — satisfiable by nobody.
//
// Yet `publicClient.getEnsAddress/getEnsText({name: "0run.eth"})` (viem's
// ENSIP-10 `UniversalResolver`-based actions) resolve it live and correctly.
// The resolver they land on, read back with `getEnsResolver`, is a tiny
// (78-byte) EIP-1167 minimal-proxy contract. Its implementation, identified
// via Blockscout's verified-source API
// (`GET /api/v2/smart-contracts/<implementation address>`), is
// `PermissionedResolver` from the official `@ens/contracts` monorepo — ENS's
// newer role-gated resolver design. That resolver stores records in a flat
// `node => Record` map with NO separate on-chain "registration" step for
// children: `setAddr(node, ...)`/`setText(node, key, value)` accept ANY
// namehash, gated by an `EnhancedAccessControl` role system
// (`resource(node, part) = keccak256(node, part)`), and roles granted at
// `ROOT_RESOURCE` (the all-zero resource, see `initialize(admin, roleBitmap)`)
// apply as a fallback to every other resource on that resolver instance —
// confirmed on-chain: `roles(ROOT_RESOURCE, ENS_OWNER_ADDRESS)` on this
// resolver reads back the all-ones bitmap (full admin), and
// `hasRootRoles(ROLE_SET_ADDR | ROLE_SET_TEXT, ENS_OWNER_ADDRESS)` returns
// `true`. So `ENS_OWNER_ADDRESS` can write records for
// `namehash("<label>.0run.eth")` directly on this same resolver contract —
// no NameWrapper call, no ENSRegistry.setSubnodeRecord, no separate
// subname-creation transaction. ENSIP-10 wildcard resolution (this resolver
// answers `resolve()` for the whole "0run.eth" subtree) is what makes a
// record keyed by a subname's namehash resolve for that subname at all.
//
// The resolver address itself is looked up LIVE via `getEnsResolver` below
// (never hardcoded) — if 0run.eth's resolver is ever migrated, this keeps
// working without a code change.
const RESOLVER_ABI = [
  "function setAddr(bytes32 node, address a)",
  "function setText(bytes32 node, string key, string value)",
  "function multicall(bytes[] calldata data) returns (bytes[] memory)",
];

/**
 * Every ENS write on this deployment goes through ONE wallet, and each call
 * built its own `ethers.Wallet`, whose nonce comes from the provider's pending
 * count. Two writes in flight at once — a mint assigning a subname while
 * someone saves a brief — therefore claimed the same nonce, and the loser was
 * rejected outright. The mint's assignment is fire-and-forget and never
 * retries, so the cost of losing that race was a coach left without an ENS
 * identity forever.
 *
 * Serializing them is enough here because this runs as a single container: one
 * writer at a time, in arrival order. A second instance would need a real
 * nonce manager, and this comment is the marker for that day.
 */
let ensWriteQueue: Promise<unknown> = Promise.resolve();
function serializeEnsWrite<T>(work: () => Promise<T>): Promise<T> {
  const next = ensWriteQueue.then(work, work);
  // Keep the chain alive whatever happens to this link.
  ensWriteQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function client() {
  const rpcUrl = process.env.ENS_SEPOLIA_RPC;
  if (!rpcUrl) throw new Error("ENS_SEPOLIA_RPC non configurato");
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
}

/**
 * Creates `<label>.<ENS_PARENT_NAME>` on Sepolia and writes its ENSIP-26
 * records in a single transaction (the resolver's own `multicall`). Never
 * throws — same receipt discipline as lib/erc8004/register.ts and
 * lib/zerog/storage.ts: this is a bonus identity step behind the mint, and a
 * failure here (wrong network, resolver revert, RPC down) must never fail or
 * delay the mint that calls it.
 */
export async function assignSubname(label: string, owner: string, records: AssignSubnameRecords): Promise<Result> {
  try {
    const parent = process.env.ENS_PARENT_NAME;
    const pk = process.env.ENS_OWNER_PRIVATE_KEY;
    const rpcUrl = process.env.ENS_SEPOLIA_RPC;
    if (!parent || !pk || !rpcUrl) {
      return { error: "configurazione ENS incompleta (ENS_PARENT_NAME/ENS_OWNER_PRIVATE_KEY/ENS_SEPOLIA_RPC)" };
    }

    const fullName = `${label}.${parent}`;
    const node = namehash(fullName);

    const resolverAddress = await client().getEnsResolver({ name: parent });
    if (!resolverAddress) return { error: `nessun resolver trovato per ${parent}` };

    const wallet = new ethers.Wallet(pk, new ethers.JsonRpcProvider(rpcUrl));
    const resolver = new ethers.Contract(resolverAddress, RESOLVER_ABI, wallet);
    const iface = resolver.interface;

    const agentPointer = `${GALILEO.chainId}:${process.env.AGENT_NFT_ADDRESS ?? ""}:${records.tokenId}`;
    const calls = [
      iface.encodeFunctionData("setAddr", [node, owner]),
      iface.encodeFunctionData("setText", [
        node,
        "agent-context",
        `0run running coach — intelligent NFT #${records.tokenId} on 0G Galileo, encrypted memory across every run`,
      ]),
      iface.encodeFunctionData("setText", [node, "agent-endpoint[web]", records.endpoint]),
      iface.encodeFunctionData("setText", [node, "0run:inft", agentPointer]),
      // `avatar` is the standard ENS text record every ENS client already
      // knows how to render, so this is what makes the coach's face show up in
      // app.ens.domains and in wallets — not just on our own pages.
      //
      // A URL, not the image: text records are on-chain strings and this PNG
      // is ~120KB, which would be absurd to write and to read. The URL is
      // stable and derived from the tokenId, so it can be written now even
      // though the portrait is generated a moment later by another background
      // step; until then it simply 404s, and it starts working on its own.
      iface.encodeFunctionData("setText", [node, "avatar", records.avatar]),
      // A2A: the machine-callable consult endpoint, and the executor key
      // authorized to sign consults FROM this agent. Publishing the signer in
      // ENS is what lets a receiving agent verify a request with nothing but
      // a name resolution — ENS as the auth registry, not just naming.
      iface.encodeFunctionData("setText", [node, "agent-endpoint[a2a]", records.a2aEndpoint]),
      ...(records.signer ? [iface.encodeFunctionData("setText", [node, "agent-signer", records.signer])] : []),
      // `description` and `url` are the ENSIP-5 keys every ENS client already
      // renders. Without them the coach shows up in app.ens.domains with a face
      // and no idea who it is: `agent-context` and `agent-endpoint[web]` carry
      // the same meaning, but only software that knows ENSIP-26 reads them.
      iface.encodeFunctionData("setText", [node, "description", records.description]),
      iface.encodeFunctionData("setText", [node, "url", records.url]),
      // Namespaced, because it is ours: it lets anyone — including a directory
      // that is not ours — filter coaches by how they coach without asking our
      // database anything.
      iface.encodeFunctionData("setText", [node, "0run:personality", records.personality]),
    ];

    const receipt = await serializeEnsWrite(async () => {
      const tx = await resolver.multicall(calls);
      return tx.wait();
    });
    return { name: fullName, txHash: receipt.hash };
  } catch (e: any) {
    return { error: e.message ?? String(e) };
  }
}

/**
 * Writes one text record on an existing name.
 *
 * Exists for `0run:erc8004`, the agent's id in the ERC-8004 IdentityRegistry.
 * It cannot go in the multicall above: the ENS assignment and the ERC-8004
 * registration are two independent background steps after a mint, and either
 * can land first — so whichever finishes second writes this record, once both
 * halves are known. Publishing it completes the chain anyone can verify from
 * the name alone: ENS name → iNFT on 0G Galileo → entry in the registry.
 *
 * Same receipt discipline as assignSubname: never throws.
 */
export async function setTextRecord(fullName: string, key: string, value: string): Promise<Result> {
  return setTextRecords(fullName, { [key]: value });
}

/**
 * Writes/overwrites text records for an EXISTING `<label>.0run.eth` name in
 * one multicall — the backfill path for records introduced after a coach was
 * minted. Same never-throws receipt discipline as assignSubname; deliberately
 * no setAddr (ownership may have moved; text records are ours to maintain).
 */
export async function setTextRecords(fullName: string, texts: Record<string, string>): Promise<Result> {
  try {
    const parent = process.env.ENS_PARENT_NAME;
    const pk = process.env.ENS_OWNER_PRIVATE_KEY;
    const rpcUrl = process.env.ENS_SEPOLIA_RPC;
    if (!parent || !pk || !rpcUrl) {
      return { error: "configurazione ENS incompleta (ENS_PARENT_NAME/ENS_OWNER_PRIVATE_KEY/ENS_SEPOLIA_RPC)" };
    }
    const node = namehash(fullName);
    // The resolver is the parent's, looked up live — a subname has no separate
    // entry to read (see the long note above).
    const resolverAddress = await client().getEnsResolver({ name: parent });
    if (!resolverAddress) return { error: `nessun resolver trovato per ${parent}` };

    const wallet = new ethers.Wallet(pk, new ethers.JsonRpcProvider(rpcUrl));
    const resolver = new ethers.Contract(resolverAddress, RESOLVER_ABI, wallet);
    const calls = Object.entries(texts).map(([key, value]) =>
      resolver.interface.encodeFunctionData("setText", [node, key, value]),
    );
    const receipt = await serializeEnsWrite(async () => {
      const tx = await resolver.multicall(calls);
      return tx.wait();
    });
    return { name: fullName, txHash: receipt.hash };
  } catch (e: any) {
    return { error: e.message ?? String(e) };
  }
}
