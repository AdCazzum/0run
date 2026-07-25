import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { count, eq, sql } from "drizzle-orm";
import { GALILEO, explorerTx } from "@0run/shared";
import { db } from "@/db";
import { coaches, runs } from "@/db/schema";
import { AskThisCoach } from "@/components/coach/ask-this-coach";
import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/site-footer";
import { CoachAvatar } from "@/components/coach/coach-avatar";

// Queries Postgres per request. Without this Next tries to prerender it at build
// time, which fails in CI (no database) and would freeze the data into the build
// even where it succeeds.
export const dynamic = "force-dynamic";

const AGENT_NFT = process.env.AGENT_NFT_ADDRESS ?? "";
const ERC8004_IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

const PERSONALITY_LABEL: Record<string, string> = {
  pacer: "Pacer — supportive companion",
  coach: "Coach — balanced and data-driven",
  drill_sergeant: "Drill Sergeant — no excuses",
};

async function loadCoach(tokenId: string) {
  if (!/^\d+$/.test(tokenId)) return null;
  // Explicit projection: `select()` here would drag the base64 avatar PNG
  // (~120KB) into a page that only needs to know whether one exists — the
  // image itself is served, and browser-cached, by /api/coach/<id>/avatar.
  const [coach] = await db
    .select({
      tokenId: coaches.tokenId,
      userId: coaches.userId,
      name: coaches.name,
      personality: coaches.personality,
      expertise: coaches.expertise,
      memoryRoot: coaches.memoryRoot,
      profileRoot: coaches.profileRoot,
      mintTx: coaches.mintTx,
      agentId: coaches.agentId,
      ensName: coaches.ensName,
      hasAvatar: sql<boolean>`${coaches.avatarImage} is not null`,
      avatarModel: coaches.avatarModel,
      avatarVerifiedTee: coaches.avatarVerifiedTee,
    })
    .from(coaches)
    .where(eq(coaches.tokenId, tokenId));
  if (!coach) return null;
  const [runCount] = await db.select({ value: count() }).from(runs).where(eq(runs.userId, coach.userId));
  return { coach, runsRead: runCount?.value ?? 0 };
}

export async function generateMetadata({ params }: { params: Promise<{ tokenId: string }> }): Promise<Metadata> {
  const { tokenId } = await params;
  const data = await loadCoach(tokenId);
  if (!data) return { title: "Coach not found — 0run" };
  return {
    title: `${data.coach.name} — an AI running coach`,
    description: `${data.coach.name} is an AI running coach that belongs to one athlete. It has read ${data.runsRead} run(s); what it learned is encrypted, and its memory is anchored on 0G Chain.`,
  };
}

/**
 * The agent's public identity page. This is the target of the ERC-8004 registry's
 * agentURI and of the ENS `agent-endpoint[web]` text record, so it must be
 * reachable without authentication — and must show only what is already public
 * on-chain: never a run, a statistic, or anything derived from the athlete's data.
 */
export default async function CoachPage({ params }: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await params;
  const data = await loadCoach(tokenId);
  if (!data) notFound();
  const { coach, runsRead } = data;

  return (
    <>
      <SiteHeader />
      <main className="relative mx-auto max-w-[1600px] px-8 py-20 md:px-16 md:py-32">
        <span
          aria-hidden
          className="absolute right-8 top-32 hidden font-sans text-[10px] uppercase tracking-[0.3em] text-ocean lg:block"
          style={{ writingMode: "vertical-rl" }}
        >
          0run / agent #{coach.tokenId}
        </span>

        <div className="flex items-center gap-4">
          <span aria-hidden className="h-px w-12 bg-navy" />
          <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">A coach with a name</span>
        </div>

        <div className="mt-8 grid grid-cols-12 gap-x-8 gap-y-12">
          <div className="col-span-12 md:col-span-7">
            <CoachAvatar
              tokenId={coach.tokenId}
              name={coach.name}
              hasAvatar={coach.hasAvatar}
              size={160}
              className="mb-8"
            />
            <h1 className="font-serif text-6xl leading-[0.9] text-navy md:text-8xl">{coach.name}</h1>
            <p className="mt-8 max-w-md font-sans text-lg leading-relaxed text-navy">
              An AI running coach that belongs to one athlete — and to them{" "}
              <em className="font-serif italic text-orange">only</em>. It has read {runsRead}{" "}
              {runsRead === 1 ? "run" : "runs"} so far, and gets sharper with every one.
            </p>
            {coach.expertise && (
              <p className="mt-6 max-w-md font-sans text-lg leading-relaxed text-navy">
                <span className="font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">Knows</span>
                <br />
                {coach.expertise}
              </p>
            )}
            <p className="mt-6 max-w-md font-sans text-sm leading-relaxed text-ocean">
              {PERSONALITY_LABEL[coach.personality] ?? coach.personality}. What it learned is locked with a key only its
              athlete holds — not even we can read it — so you will find nothing about their training on this page. What
              you can check, below, is that this coach is real: it exists as an intelligent NFT on 0G Chain, and every
              time it reads a run, a fingerprint of its memory is written there.
            </p>
          </div>

          <dl className="col-span-12 space-y-8 border-t border-navy pt-8 md:col-span-4 md:col-start-9">
            <Row label="chain">
              {GALILEO.name} · {GALILEO.chainId}
            </Row>
            {coach.ensName && (
              <Row label="findable as">
                <Ext href={`https://sepolia.app.ens.domains/${coach.ensName}`}>{coach.ensName} ↗</Ext>
              </Row>
            )}
            <Row label="coach">#{coach.tokenId}</Row>
            {AGENT_NFT && (
              <Row label="lives in">
                <Ext href={`${GALILEO.explorer}/address/${AGENT_NFT}`}>{short(AGENT_NFT)} ↗</Ext>
              </Row>
            )}
            {coach.mintTx && (
              <Row label="minted">
                <Ext href={explorerTx(coach.mintTx)}>{short(coach.mintTx)} ↗</Ext>
              </Row>
            )}
            <Row label="memory fingerprint">
              <span className="break-all font-sans text-[10px] tracking-normal">{coach.memoryRoot || "—"}</span>
            </Row>
            {coach.hasAvatar && (
              <Row label="portrait">
                {/* Said as measured: this model returns an attestation per job,
                    so "verified" here is a fact about THIS image, not a claim
                    about the platform. */}
                {coach.avatarModel ?? "generated"} on 0G Compute ·{" "}
                {coach.avatarVerifiedTee === "true" ? "TEE verified" : "attestation unavailable"}
              </Row>
            )}
            <Row label="agent registry">
              <Ext href={`${GALILEO.explorer}/address/${ERC8004_IDENTITY_REGISTRY}`}>ERC-8004 ↗</Ext>
            </Row>
          </dl>
        </div>

        <AskThisCoach tokenId={coach.tokenId} coachLabel={coach.name} />

        <div className="mt-24 border-t border-navy/15 pt-10">
          <Link
            href="/coaches"
            className="inline-block py-3 font-sans text-xs uppercase tracking-[0.2em] text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline"
          >
            Every coach, discoverable ↗
          </Link>
          <Link
            href="/"
            className="ml-10 inline-block py-3 font-sans text-xs uppercase tracking-[0.2em] text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline"
          >
            What is 0run ↗
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function short(hex: string) {
  return hex.length > 14 ? `${hex.slice(0, 8)}…${hex.slice(-4)}` : hex;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">{label}</dt>
      <dd className="mt-2 font-sans text-sm text-navy">{children}</dd>
    </div>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline"
    >
      {children}
    </a>
  );
}
