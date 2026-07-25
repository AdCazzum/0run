import { ethers } from "ethers";
import { count, eq, sql } from "drizzle-orm";
import { GALILEO } from "@0run/shared";
import { db } from "@/db";
import { coaches, runs } from "@/db/schema";
import { resolveCoachEns } from "@/lib/ens/resolve";
import { slugifyLabel } from "@/lib/ens/subname";
import { ensureAvatarInBackground } from "@/lib/avatar/ensure";

const NFT_ABI = [
  "function nextId() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
];

function nftReader() {
  const provider = new ethers.JsonRpcProvider(process.env.ZG_RPC_URL ?? GALILEO.rpcUrl);
  return new ethers.Contract(process.env.AGENT_NFT_ADDRESS ?? "", NFT_ABI, provider);
}

export type InftPointer = { chainId: number; contract: string; tokenId: string };

export type DirectoryEntry = {
  tokenId: string;
  owner: string;
  // From apps/web `coaches` table — the DB is never used to decide whether an
  // agent EXISTS (that's chain-only, see getCoachDirectory's doc comment
  // below), only to fill in the two things chain/ENS cannot answer: the
  // personality the athlete configured, and (mirroring
  // app/coach/[tokenId]/page.tsx) how many runs it has read.
  personality: string | null;
  // What the athlete said this coach knows, at creation. The reason the
  // directory is useful rather than a list of names.
  expertise: string | null;
  runCount: number | null;
  // The ENS name this tokenId is identified by — normally coaches.ensName,
  // written by assignSubname() at mint time. When that column is empty the
  // name is REDISCOVERED from the chain instead (see recoverEnsName below),
  // so a lost DB write cannot erase an identity that exists on Sepolia.
  // Either way this is a POINTER that was resolved, not a claim in itself.
  ensName: string | null;
  // Live result of resolving `ensName` just now, via resolveCoachEns() — no
  // cache inside that call, no hard-coded fallback. Null when ensName is
  // null OR the live resolution failed (RPC down, record cleared, etc).
  ensAddress: string | null;
  ensRecords: Record<string, string>;
  // Whether this coach has a generated avatar (see components/coach/coach-avatar.tsx).
  // A boolean, never the image: the PNG is ~120KB and this list is rebuilt on a
  // page load, so the bytes are fetched by the browser from the avatar route.
  hasAvatar: boolean;
  // The name to actually show as this agent's identity. Equals `ensName`
  // ONLY when live resolution just succeeded (ensAddress is non-null) —
  // never invented, never falls back to a typed/DB display name.
  displayName: string | null;
  // Parsed `0run:inft` text record (`chainId:contract:tokenId`), if present.
  inft: InftPointer | null;
  // True when `inft` is present but disagrees with the on-chain identity
  // actually being shown (wrong chain, wrong contract, or wrong tokenId).
  // A mismatch is surfaced, never silently dropped — see route/page.
  mismatch: boolean;
};

const CACHE_TTL_MS = 60_000;
let cache: { data: DirectoryEntry[]; expiresAt: number } | null = null;

/** Test-only: clears the in-process cache so each test starts from a clean slate. */
export function _resetDirectoryCacheForTest() {
  cache = null;
}

/**
 * Every coach agent that exists on-chain, resolved to its live ENS identity.
 *
 * Existence comes ONLY from the chain: `OrunAgentNFT.nextId()` gives one past
 * the highest tokenId ever minted (IDs are sequential from 1, no burn
 * function — see contracts/contracts/OrunAgentNFT.sol), and `ownerOf(id)`
 * confirms each one individually. `0run.eth` subnames cannot be enumerated —
 * `0run.eth` itself has no entry in the canonical ENS Registry at all (see
 * the dated section in docs/decisions.md and apps/web/src/lib/ens/subname.ts),
 * so there is no on-chain "list of subnames" to read. Chain enumeration,
 * then per-entry ENS resolution, is the only honest order of operations.
 *
 * ERC-8004's IdentityRegistry was considered as the enumeration source too,
 * but its agent IDs are a single shared counter across every project that
 * registers there, not just 0run's — reliably listing only OUR agents would
 * mean scanning `Registered` event logs rather than a cheap sequential read.
 * OrunAgentNFT's own counter has no such ambiguity, so it is the primary (and
 * only) enumeration source here.
 *
 * Cached in-process for CACHE_TTL_MS: building this list does 1 + 2N RPC
 * round trips across two networks (0G Galileo chain reads, Sepolia ENS
 * reads), so every request re-running it would be both slow and needlessly
 * expensive. A failed build is NEVER cached — see the try/catch shape below:
 * only a successful `data` array is written to `cache`, so an RPC outage is
 * retried on the very next call instead of being remembered as "no coaches".
 */
export async function getCoachDirectory(): Promise<DirectoryEntry[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.data;
  const data = await buildDirectory();
  cache = { data, expiresAt: now + CACHE_TTL_MS };
  return data;
}

async function buildDirectory(): Promise<DirectoryEntry[]> {
  const nft = nftReader();
  // Deliberately NOT try/caught: a failure here (RPC down, bad address, ...)
  // must propagate as an honest error to the caller, never collapse into an
  // empty array that reads as "no coaches exist".
  const nextId: bigint = await nft.nextId();
  const total = Number(nextId) - 1;
  if (total <= 0) return [];

  const ids = Array.from({ length: total }, (_, i) => i + 1);
  // Promise.allSettled: one tokenId's ownerOf() reverting (should never
  // happen for an ID below nextId, since OrunAgentNFT has no burn — but
  // defend against it anyway) must not take the whole directory down with it.
  const settled = await Promise.allSettled(
    ids.map(async (id) => ({ tokenId: String(id), owner: (await nft.ownerOf(id)) as string })),
  );
  const agents = settled
    .filter((r): r is PromiseFulfilledResult<{ tokenId: string; owner: string }> => r.status === "fulfilled")
    .map((r) => r.value);

  // Explicit projection: `select()` would pull coaches.avatar_image (a base64
  // PNG per row) across the wire on every directory build, for a boolean.
  const dbRows = await db
    .select({
      tokenId: coaches.tokenId,
      userId: coaches.userId,
      name: coaches.name,
      personality: coaches.personality,
      expertise: coaches.expertise,
      ensName: coaches.ensName,
      hasAvatar: sql<boolean>`${coaches.avatarImage} is not null`,
    })
    .from(coaches);
  const byTokenId = new Map(dbRows.map((r) => [r.tokenId, r] as const));

  return Promise.all(
    agents.map(async ({ tokenId, owner }) => {
      const dbRow = byTokenId.get(tokenId);

      // A coach we know about but have never drawn gets its portrait ordered
      // now, in the background, and shows up with one on a later load.
      if (dbRow && !dbRow.hasAvatar) ensureAvatarInBackground(dbRow);

      let runCount: number | null = null;
      if (dbRow) {
        const [row] = await db.select({ value: count() }).from(runs).where(eq(runs.userId, dbRow.userId));
        runCount = row?.value ?? 0;
      }

      let ensName = dbRow?.ensName ?? null;
      let ensAddress: string | null = null;
      let ensRecords: Record<string, string> = {};
      if (ensName) {
        const resolution = await resolveCoachEns(ensName);
        ensAddress = resolution.address;
        ensRecords = resolution.records;
      } else if (dbRow) {
        const recovered = await recoverEnsName(dbRow.name, tokenId);
        if (recovered) {
          ensName = recovered.name;
          ensAddress = recovered.address;
          ensRecords = recovered.records;
        }
      }
      const displayName = ensAddress ? ensName : null;

      const inft = parseInftPointer(ensRecords["0run:inft"]);
      const mismatch = inft ? pointsElsewhere(inft, tokenId) : false;

      return {
        tokenId,
        owner,
        personality: dbRow?.personality ?? null,
        expertise: dbRow?.expertise ?? null,
        hasAvatar: dbRow?.hasAvatar ?? false,
        runCount,
        ensName,
        ensAddress,
        ensRecords,
        displayName,
        inft,
        mismatch,
      };
    }),
  );
}

/**
 * Recovers an agent's ENS name when `coaches.ens_name` is empty.
 *
 * The mint route assigns the subname and stores it in two separate steps, so
 * the second one can be lost (crash, restart, a column that was not yet
 * migrated) while the name itself is very much alive on Sepolia. Without this,
 * such an agent would be permanently nameless in the directory — an artefact
 * of our index, presented as a fact about ENS.
 *
 * Recovery is a GUESS about the label (the same slug assignSubname derives
 * from the coach's name) and is therefore only trusted against proof: the
 * name must resolve to an address right now AND its `0run:inft` text record
 * must point back at exactly this agent — this chain, this contract, this
 * tokenId. A name that resolves but points elsewhere belongs to someone else
 * and is discarded, never shown. Nothing is written back to the database
 * here: this function reads, and its caller renders what it read.
 */
async function recoverEnsName(
  coachName: string,
  tokenId: string,
): Promise<{ name: string; address: string; records: Record<string, string> } | null> {
  const parent = process.env.ENS_PARENT_NAME;
  if (!parent) return null;

  const candidate = `${slugifyLabel(coachName, tokenId)}.${parent}`;
  const resolution = await resolveCoachEns(candidate).catch(() => null);
  if (!resolution?.address) return null;

  const pointer = parseInftPointer(resolution.records["0run:inft"]);
  if (!pointer || pointsElsewhere(pointer, tokenId)) return null;

  return { name: candidate, address: resolution.address, records: resolution.records };
}

/** True when an `0run:inft` pointer does not identify the agent being shown. */
function pointsElsewhere(pointer: InftPointer, tokenId: string): boolean {
  return (
    pointer.chainId !== GALILEO.chainId ||
    pointer.contract.toLowerCase() !== (process.env.AGENT_NFT_ADDRESS ?? "").toLowerCase() ||
    pointer.tokenId !== tokenId
  );
}

function parseInftPointer(value: string | undefined): InftPointer | null {
  if (!value) return null;
  const parts = value.split(":");
  // Malformed (not exactly chainId:contract:tokenId) — represent it as a
  // pointer that can never match, rather than throwing or silently ignoring
  // a record that IS present. The mismatch it produces is accurate: whatever
  // is in this text record does not verifiably point at the agent shown.
  if (parts.length !== 3) return { chainId: NaN, contract: value, tokenId: "" };
  const [chainIdStr, contract, tokenId] = parts;
  return { chainId: Number(chainIdStr), contract, tokenId };
}
