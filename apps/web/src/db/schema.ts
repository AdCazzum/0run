import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import type { RunStats } from "@0run/shared";

export type RunStep = "encrypt" | "store_gpx" | "update_memory" | "registry_tx" | "inference";
export type StepState = { status: "pending" | "done" | "error"; detail?: string };

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  privyDid: text("privy_did").notNull().unique(),
  wallet: text("wallet").notNull(),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
