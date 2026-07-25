import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
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
  // ERC-8004 IdentityRegistry agentId (see lib/erc8004/register.ts), filled
  // in by a best-effort background step after the mint. Nullable: rows
  // minted before this column existed predate it, and a coach the ERC-8004
  // registration failed for is still a fully valid coach — this is a bonus
  // identity, never a requirement to mint.
  agentId: text("agent_id"),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
