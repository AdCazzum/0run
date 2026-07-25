import { integer, jsonb, pgTable, primaryKey, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import type { RunStats } from "@0run/shared";

export type RunStep = "encrypt" | "store_gpx" | "update_memory" | "registry_tx" | "score" | "inference";
export type StepState = { status: "pending" | "done" | "error"; detail?: string };

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  privyDid: text("privy_did").notNull().unique(),
  wallet: text("wallet").notNull(),
  fundedCount: integer("funded_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const coaches = pgTable("coaches", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull().unique(),
  tokenId: text("token_id").notNull(),
  name: text("name").notNull(),
  personality: text("personality").notNull(),
  memoryRoot: text("memory_root").notNull(),
  profileRoot: text("profile_root").notNull(),
  mintTx: text("mint_tx").notNull(),
  // Cache of the SAME AES envelope string produced by encryptJson(memory,
  // userKey) — ciphertext only, never plaintext, so a DB dump alone still
  // leaks nothing without the user's wallet signature. 0G Storage remains
  // the durable, verifiable, on-chain-anchored source of truth (memoryRoot);
  // this column exists because a freshly uploaded blob is not reliably
  // downloadable from 0G Storage for 16+ minutes (measured against Galileo
  // testnet, see docs/0g-reality-check.md) — reading it back on the hot path
  // (e.g. a user's first run right after minting) would fail every time.
  // Nullable because rows minted before this column existed predate it; the
  // pipeline falls back to downloadDecrypted(memoryRoot) when null (the
  // re-sync path, where blobs are old and finalized).
  memoryCipher: text("memory_cipher"),
  // When the row was created as a mint reservation. A row still holding the
  // empty-string placeholders after a generous window means a mint died
  // mid-flight (crash, restart, misconfiguration), so the next attempt may
  // reclaim it instead of the user being locked out of minting forever.
  reservedAt: timestamp("reserved_at").defaultNow().notNull(),
  // The anonymous World AgentBook identifier of the human behind this agent.
  // UNIQUE carries the "one human = one coach" rule for the rows that HAVE one:
  // two concurrent mints from two accounts of the same person cannot both win
  // it, the way application-level checks would let them.
  //
  // What it does NOT cover, because a nullable unique index never collides on
  // NULL: every coach minted while REQUIRE_HUMAN_BACKED_MINT was off (the
  // default) or before this column existed. Those rows hold NULL, so their
  // owner can still mint again from another account. Treat this constraint as
  // "no verified human appears twice among the mints we verified", never as
  // "one person can only ever hold one agent" — and note the NFT is
  // transferable, so ownership can diverge from who minted it in any case.
  humanId: text("human_id").unique(),
  // ERC-8004 IdentityRegistry agentId (see lib/erc8004/register.ts), filled
  // in by a best-effort background step after the mint. Nullable: rows
  // minted before this column existed predate it, and a coach the ERC-8004
  // registration failed for is still a fully valid coach — this is a bonus
  // identity, never a requirement to mint.
  agentId: text("agent_id"),
  // Live ENS identity (see lib/ens/subname.ts), e.g. "pedro.0run.eth" on
  // Sepolia — a different network from the coach's own chain, assigned by a
  // best-effort background step after the mint. Nullable for the same reason
  // as agentId above: rows minted before this column existed predate it, and
  // a coach ENS assignment failed for is still a fully valid coach.
  ensName: text("ens_name"),
  // What this coach knows, in the athlete's own words at creation (see
  // @0run/shared EXPERTISE_MAX). PUBLIC by design: it is shown on the coach's
  // page, published in its ENS description, and read by anyone deciding whose
  // coach to consult. Duplicated here from the profile layer — which stays the
  // source of truth for what the model reads — so a public page can render it
  // without decrypting anything. Nullable: most coaches have none.
  expertise: text("expertise"),

  // Cache of the SAME service-key envelope stored at profileRoot on 0G
  // Storage — the aggregate a stranger's request is allowed to see (name,
  // personality, totals, pace trend, style notes), never the private layer.
  // Exists for the identical reason as memoryCipher above: "ask this coach"
  // is a hot, stranger-facing path, and a freshly uploaded blob is not
  // downloadable from 0G Storage for 16+ minutes. Nullable: rows minted
  // before this column existed fall back to downloading profileRoot.
  profileCipher: text("profile_cipher"),

  // --- Avatar (0G Compute, z-image-turbo) ---------------------------------
  // The coach's face, generated once at mint from a prompt derived from its
  // name and personality (lib/avatar/generate.ts). Stored as base64 PNG in the
  // index rather than on 0G Storage because it is served on every page load
  // and a freshly uploaded blob is not downloadable for 16+ minutes (see
  // memoryCipher above). Public by nature — an avatar is the one thing about a
  // coach meant to be seen by strangers — so unlike memory it is not encrypted.
  // Nullable everywhere: generation is a best-effort background step and a
  // coach without a face is a fully working coach.
  avatarImage: text("avatar_image"),
  avatarModel: text("avatar_model"),
  // "true" | "false" | "unavailable" — whether THIS image came with a TEE
  // attestation from the provider. Recorded as measured, never asserted.
  avatarVerifiedTee: text("avatar_verified_tee"),

  // --- Health data (docs/superpowers/specs/2026-07-25-health-data-spec.md) --
  // COVERAGE METADATA ONLY — never a health value. The values themselves
  // live exclusively in the user-key-encrypted memory (privateLayer.
  // healthSnapshot, see @0run/shared) and, raw, on 0G Storage under
  // healthRoot. This is the same "index, not source of truth" role
  // memoryRoot/profileRoot play for the rest of the coach: the UI reads
  // ONLY these columns to render "N days · resting HR, HRV, sleep, steps" —
  // never a number. All nullable: most coaches never upload health data.
  //
  // Root hash of the RAW export, encrypted with the athlete's own user key
  // and uploaded to 0G Storage (see /api/health-data) — same "committed
  // locally via prepareEncryptedUpload before the slow network upload even
  // starts" pattern as the mint route's memory/profile roots.
  healthRoot: text("health_root"),
  // parseHealthExport()'s coverage window — first/last day with any data and
  // the day count, so the UI can say "7 days" without decrypting anything.
  healthWindowDays: integer("health_window_days"),
  healthFrom: text("health_from"), // YYYY-MM-DD
  healthTo: text("health_to"), // YYYY-MM-DD
  // Which metrics were present in the export (e.g. ["restingHr","hrvSdnnMs",
  // "sleepMin"]) — names only, never a single measurement.
  healthMetrics: jsonb("health_metrics").$type<string[]>(),
  // snapshot.exportedAt as reported by the export file itself (a date/time
  // string, not a value in the health sense).
  healthExportedAt: text("health_exported_at"),
  // When 0run last accepted a health upload for this coach (server clock,
  // distinct from healthExportedAt above).
  healthUploadedAt: timestamp("health_uploaded_at"),
});

export const runs = pgTable("runs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  status: text("status", { enum: ["processing", "done", "error"] }).notNull(),
  steps: jsonb("steps").$type<Record<RunStep, StepState>>().notNull(),
  stats: jsonb("stats").$type<RunStats>(),
  polyline: jsonb("polyline").$type<[number, number][]>(),
  gpxRoot: text("gpx_root"),
  registryTx: text("registry_tx"),
  report: jsonb("report").$type<{ headline: string; analysis: string; comparison: string; advice: string[] }>(),
  // Ciphertext ONLY (encryptJson(feelings, userKey) — same AES-256-GCM
  // envelope format as coaches.memoryCipher), for the free-text "how did it
  // feel" note captured at upload. Deliberately narrower than the rest of
  // this table: `stats` and `report` above are plaintext JSON in this index
  // today, but free text is more sensitive than pace/elevation (it can
  // carry health or mood information), so the encrypted CoachMemory
  // (privateLayer.runs[].feelings, see packages/shared/src/types.ts) is the
  // source of truth and this column exists only so the run detail page can
  // decrypt-on-read without a 0G Storage round trip. This is NOT a claim
  // that runs.stats/runs.report are safe as-is — moving them behind
  // encryption too is a known, unaddressed follow-up. Null when no feelings
  // were submitted for this run.
  feelingsCipher: text("feelings_cipher"),
  verifiedTee: text("verified_tee"), // "true" | "false" | "unavailable"
  model: text("model"),
  // Attested effort score (1-5), produced on the TEE-verified 0G Compute
  // "direct" path — separate from the narrative report above, which runs on
  // the router. See apps/web/src/lib/coach/score.ts and
  // docs/0g-reality-check.md ("Router contro Direct") for why the two are
  // split. All three are nullable: the direct path is a single provider on a
  // testnet and can be unavailable — a missing score never fails the run.
  effortScore: integer("effort_score"),
  scoreNote: text("score_note"),
  scoreVerified: text("score_verified"), // "true" | "false" | "unavailable"
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  // A2A consult attached to this assistant turn, if the coach consulted a
  // colleague while answering (docs/superpowers/specs/2026-07-25-a2a-ens-design.md).
  // The full cross-coach exchange, so the UI can re-render the consult block.
  // Null on every normal turn and on all user turns.
  consult: jsonb("consult").$type<{
    to: string; toTokenId: string | null; question: string; reply: string; coachName: string;
    humanBacked?: { humanId: string } | null;
  } | null>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Piano B, Task 2 — events + World-ID-gated claims (see docs/superpowers/plans/
// 2026-07-25-0run-social-identity.md and RunEvents.sol). Anyone can create an
// event (permissionless), so a claim proves "one unique real person per
// event", never attendance — the honest trust model is repeated in the UI,
// never just here.
export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  // RunEvents eventId (uint256, decimal string) — the on-chain anchor. Unique
  // because it 1:1 maps to a row created right after a successful
  // createEvent() tx (see api/events/route.ts).
  onchainId: text("onchain_id").notNull().unique(),
  creatorUserId: integer("creator_user_id").references(() => users.id).notNull(),
  name: text("name").notNull(),
  startsAt: timestamp("starts_at").notNull(),
  endsAt: timestamp("ends_at").notNull(),
  uri: text("uri"),
  txHash: text("tx_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Piano B, Task 5 — self-declared coach badge (see docs/superpowers/specs/
// 2026-07-25-real-coach-spec.md and docs/superpowers/plans/
// 2026-07-25-0run-social-identity.md). World ID proves a unique real human,
// never a qualified coach, so this table only ever backs a badge that reads
// "coach · autodichiarato" (self-declared) — never "verified". One claim per
// account (userId UNIQUE) and the nullifier itself is UNIQUE across every
// claim, which is the actual anti-replay defense (Postgres constraint, not
// application logic) against the same World-verified human claiming twice.
export const coachClaims = pgTable("coach_claims", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull().unique(),
  nullifierHash: text("nullifier_hash").notNull().unique(),
  claimedAt: timestamp("claimed_at").defaultNow().notNull(),
});

export const claims = pgTable("claims", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").references(() => events.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  // World ID nullifier hash for THIS event's signal — the real anti-replay
  // anchor (see lib/world/verify.ts). The UNIQUE constraint below is the
  // actual defense against a proof being claimed twice, in Postgres, not in
  // memory: a second insert attempt for the same (eventId, nullifierHash)
  // conflicts and the route surfaces it as 409.
  nullifierHash: text("nullifier_hash").notNull(),
  // Set once the claimant's OWN wallet has submitted RunEvents.claim()
  // on-chain and it confirmed (see api/events/[id]/claim/route.ts PATCH).
  // Null between "World ID verified, backend co-signature issued" and "tx
  // confirmed" — the row itself, inserted right after verification, is what
  // reserves the nullifier and blocks a concurrent replay.
  txHash: text("tx_hash"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique("claims_event_nullifier_unique").on(table.eventId, table.nullifierHash),
]);

// AgentKit per-human usage counters (spec 2026-07-25-agentkit-human-backing).
// One row per (endpoint bucket, humanId); the endpoint key embeds the UTC day
// ("a2a:2026-07-25") so the "daily" window needs no cron and no timestamp
// arithmetic. Deliberately content-free — no wallets, no questions, no ENS
// names: accountability metadata only.
export const agentkitUsage = pgTable(
  "agentkit_usage",
  {
    endpoint: text("endpoint").notNull(),
    humanId: text("human_id").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => ({ pk: primaryKey({ columns: [t.endpoint, t.humanId] }) }),
);
