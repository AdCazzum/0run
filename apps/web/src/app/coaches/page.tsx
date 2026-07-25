import type { Metadata } from "next";
import Link from "next/link";
import { GALILEO } from "@0run/shared";
import { getCoachDirectory, type DirectoryEntry } from "@/lib/coach/directory";
import { PageChrome } from "@/components/ui/page-chrome";
import { SiteHeader } from "@/components/landing/site-header";
import { SiteFooter } from "@/components/landing/site-footer";

export const metadata: Metadata = {
  title: "Coach directory — 0run",
  description:
    "Every 0run coach agent whose ENS identity resolves live, enumerated from the ERC-7857 agent registry on 0G Galileo.",
};

// Always hit the (internally 60s-cached) live directory — never a
// build-time snapshot of who happened to be minted at deploy time.
export const dynamic = "force-dynamic";

const AGENT_NFT_ADDRESS = process.env.AGENT_NFT_ADDRESS ?? "";

const PERSONALITY_LABEL: Record<string, string> = {
  pacer: "Pacer — supportive companion",
  coach: "Coach — balanced and data-driven",
  drill_sergeant: "Drill Sergeant — no excuses",
};

/**
 * An agent whose ENS identity resolved live — the only kind this page lists.
 * `displayName` non-null implies `ensAddress` non-null (see directory.ts), so
 * every card below can link to a name that answers a real lookup.
 */
type ResolvedEntry = DirectoryEntry & { displayName: string };

/**
 * Public, unauthenticated directory — a judge, or another agent's crawler,
 * has to be able to read this without logging in. Every entry here is an
 * agent that exists on-chain (see lib/coach/directory.ts for exactly how
 * that's established); ENS never enumerates the list, it only identifies
 * entries that are already known to exist.
 */
export default async function CoachesDirectoryPage() {
  let onChain: DirectoryEntry[] = [];
  let loadFailed = false;
  try {
    onChain = await getCoachDirectory();
  } catch (e) {
    // The detail goes to the server log, not the page: building this list
    // touches two chains and the local index, and printing whichever one
    // failed verbatim both misattributes the cause to readers (a failing
    // Postgres query once rendered as "the chain is unreachable") and puts
    // internal errors on a public page.
    console.error("coach directory build failed", e);
    loadFailed = true;
  }

  // The directory lists agents that carry an ENS identity: `displayName` is set
  // only when the name resolved LIVE a moment ago, so this filter is "has a name
  // that works right now", not "has a name recorded somewhere".
  const entries = onChain.filter((e): e is ResolvedEntry => e.displayName !== null);
  // Kept apart so an ENS/RPC problem can never be rendered as "no agents exist":
  // agents on-chain whose identity did not resolve are counted, not erased.
  const unresolvedCount = onChain.length - entries.length;

  return (
    <>
      <SiteHeader />
      <main className="relative mx-auto max-w-[1600px] px-8 py-20 md:px-16 md:py-32">
        <PageChrome />
        <span
          aria-hidden
          className="absolute right-8 top-32 hidden font-sans text-[10px] uppercase tracking-[0.3em] text-ocean lg:block"
          style={{ writingMode: "vertical-rl" }}
        >
          0run / agent directory
        </span>

        <div className="flex items-center gap-4">
          <span aria-hidden className="h-px w-12 bg-navy" />
          <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">Onchain, resolved live</span>
        </div>

        <h1 className="mt-8 max-w-3xl font-serif text-6xl leading-[0.9] text-navy md:text-8xl">
          Every coach, <em className="font-serif italic text-orange">discoverable</em>.
        </h1>
        <p className="mt-8 max-w-xl font-sans text-lg leading-relaxed text-navy">
          Enumerated straight from the agent registry on 0G Galileo, then named live through ENS.
          Only agents whose ENS identity resolves right now appear here, so every name below is one
          you can look up yourself — never a database claiming to be the list.
        </p>

        {loadFailed && (
          <p className="mt-12 max-w-xl border-t border-navy/15 pt-8 font-sans text-sm leading-relaxed text-ocean">
            The directory could not be built just now. This is a live failure — of a chain read, an
            ENS lookup, or the local index — not an empty directory: reload in a moment.
          </p>
        )}

        {!loadFailed && entries.length === 0 && (
          <p className="mt-12 max-w-xl border-t border-navy/15 pt-8 font-sans text-sm leading-relaxed text-ocean">
            {unresolvedCount > 0
              ? `${unresolvedCount} ${unresolvedCount === 1 ? "agent exists" : "agents exist"} on-chain, but no ENS identity resolves at this moment — a resolution problem, not an empty registry.`
              : "No agent has minted a coach yet."}
          </p>
        )}

        {!loadFailed && entries.length > 0 && unresolvedCount > 0 && (
          <p className="mt-12 max-w-xl font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">
            {unresolvedCount} more {unresolvedCount === 1 ? "agent exists" : "agents exist"} on-chain
            without a resolving ENS identity
          </p>
        )}

        {!loadFailed && entries.length > 0 && (
          <ul className="mt-16 grid grid-cols-12 gap-x-8 gap-y-16 border-t border-navy/15 pt-16">
            {entries.map((entry) => (
              <li key={entry.tokenId} className="col-span-12 md:col-span-6 lg:col-span-4">
                <DirectoryCard entry={entry} />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-24 border-t border-navy/15 pt-10">
          <Link
            href="/"
            className="inline-block py-3 font-sans text-xs uppercase tracking-[0.2em] text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline"
          >
            What is 0run ↗
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function DirectoryCard({ entry }: { entry: ResolvedEntry }) {
  const runsLabel =
    entry.runCount === null ? "run count unavailable" : `${entry.runCount} ${entry.runCount === 1 ? "run" : "runs"} read`;
  const personalityLabel = entry.personality ? PERSONALITY_LABEL[entry.personality] ?? entry.personality : "personality unknown";

  return (
    <article className="border-t border-navy pt-6 transition-colors duration-500 hover:bg-peach/20">
      {/* The ENS name IS the heading: it is the agent's identity, and the page only
          lists agents whose name resolved a moment ago, so it is always present. */}
      <h2 className="font-serif text-4xl leading-tight text-orange">{entry.displayName}</h2>
      <p className="mt-2 font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">
        agent #{entry.tokenId}
      </p>

      <p className="mt-4 font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">
        {personalityLabel} · {runsLabel}
      </p>

      {/* The round trip both ways: the ENS text record 0run:inft says
          chainId:contract:tokenId, and the on-chain NFT confirms the tokenId
          this card is actually showing. Shown honestly either way. */}
      {entry.inft && (
        <p
          className={`mt-4 font-sans text-[10px] uppercase tracking-[0.25em] ${
            entry.mismatch ? "text-orange" : "text-ocean"
          }`}
        >
          {entry.mismatch ? "ENS ↔ chain pointer disagrees — flagged, not hidden" : "ENS ↔ chain pointer verified"}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
        <a
          href={`https://sepolia.app.ens.domains/${entry.displayName}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-sans text-[10px] uppercase tracking-[0.25em] text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline"
        >
          ens · sepolia ↗
        </a>
        {AGENT_NFT_ADDRESS && (
          <a
            href={`${GALILEO.explorer}/address/${AGENT_NFT_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-sans text-[10px] uppercase tracking-[0.25em] text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline"
          >
            chain · galileo ↗
          </a>
        )}
        <Link
          href={`/coach/${entry.tokenId}`}
          className="font-sans text-[10px] uppercase tracking-[0.25em] text-navy underline-offset-4 transition-colors duration-500 hover:text-orange hover:underline"
        >
          agent identity ↗
        </Link>
      </div>
    </article>
  );
}
