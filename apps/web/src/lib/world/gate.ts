import { NextResponse } from "next/server";
import { agentBookAddress, lookupHumanId } from "@/lib/world/agentbook";
import { agentkitStorage } from "@/lib/world/agentkitStorage";

/**
 * "Owning an agent requires proving you are a unique human."
 *
 * Consulting other people's coaches does not, and never will: the constraint is
 * on ownership, not on access. The reason is concrete rather than moral —
 * minting is free and WE pay the gas, so one person could otherwise mint agents
 * until the funder is empty.
 *
 * Two limits of this gate, stated here because the code cannot enforce them and
 * comments elsewhere used to claim otherwise:
 *
 * - It does not make the public directory floodable-proof. OrunAgentNFT.mint is
 *   permissionless and /coaches is enumerated from the chain, so anyone with
 *   Galileo gas can create tokens that appear there without ever touching this
 *   gate. What the gate protects is OUR treasury and the one-coach-per-person
 *   product rule, not the chain.
 * - It binds a human to a MINT, not to a coach forever: the NFT is transferable,
 *   so a person can end up holding an agent someone else minted.
 *
 * Enforcement is OPT-IN (`REQUIRE_HUMAN_BACKED_MINT=1`). It used to default to
 * on, which locked every user out of minting: registration happens in World App
 * via `npx @worldcoin/agentkit-cli register <wallet>`, and nothing inside 0run
 * can do it for them. A gate nobody can pass is an outage, not a policy.
 */
export function humanBackingEnforced(): boolean {
  return process.env.REQUIRE_HUMAN_BACKED_MINT === "1";
}

/** Same opt-in convention as the mint gate, for the agent→agent surface. */
export function a2aHumanBackingEnforced(): boolean {
  return process.env.REQUIRE_HUMAN_BACKED_A2A === "1";
}

/** Consults per day per humanId, across ALL agents that human backs. */
export function a2aDailyQuotaPerHuman(): number {
  const n = Number(process.env.A2A_DAILY_QUOTA_PER_HUMAN);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
}

export type GateResult =
  /** Let the request through. `humanId` is null when the gate is not enforced. */
  | { ok: true; humanId: string | null }
  /** Refuse, with the response to return verbatim. */
  | { ok: false; response: NextResponse };

/**
 * Resolves the human behind a wallet and decides whether the request proceeds.
 *
 * Call this BEFORE reserving or spending anything: a refusal after a write is
 * how this route stranded rows and locked users out permanently, twice.
 */
export async function checkHumanBacking(wallet: string): Promise<GateResult> {
  const enforced = humanBackingEnforced();
  const lookup = await lookupHumanId(wallet);

  if (lookup.error) {
    if (!enforced) {
      console.warn("human-backing lookup unavailable, proceeding because the gate is not enforced", lookup.error);
      return { ok: true, humanId: null };
    }
    // "Unknown" is neither a yes nor a no. Saying "you are not human" because a
    // World Chain RPC blinked would be a lie, and letting it through would make
    // the gate decorative.
    return {
      ok: false,
      response: NextResponse.json(
        { error: "impossibile verificare ora il legame con un umano verificato, riprova", detail: lookup.error },
        { status: 503 },
      ),
    };
  }

  if (!enforced) {
    // Not enforced means not enforced: the humanId is deliberately dropped
    // rather than recorded, because recording it would let the database's
    // UNIQUE constraint keep refusing a second coach for the same person —
    // exactly the policy this flag says it relaxes.
    return { ok: true, humanId: null };
  }

  if (!lookup.humanId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "per possedere un coach serve dimostrare di essere una persona reale e unica",
          reason: "human_backing_required",
          wallet,
          // Registration is a human action a service cannot perform for them —
          // but the mint page now hosts the whole flow (HumanBackingWidget):
          // World App on the phone, one QR, a gasless relay. No CLI.
          howTo: "usa il riquadro 'verify with World App' qui sopra: scansiona il QR col telefono e approva",
          note: "consultare i coach di altri resta libero: il vincolo è sulla proprietà di un agente, non sull'accesso",
        },
        { status: 403 },
      ),
    };
  }

  return { ok: true, humanId: lookup.humanId };
}

export type A2aAdmission =
  | { ok: true; humanBacked: { humanId: string } | null }
  | { ok: false; response: NextResponse };

/**
 * Admission control for the agent→agent consult endpoint. ENS already told
 * the route WHO is speaking (agent-signer signature); this decides whether a
 * real, unique human stands behind that name — `callerAddress` is the ENS
 * `addr` of the calling agent, the accountable wallet of the delegation
 * chain human → wallet (AgentBook) → name (ENS addr) → key (agent-signer).
 *
 * Enforcement is opt-in (REQUIRE_HUMAN_BACKED_A2A=1), same convention as the
 * mint gate. With the flag off the lookup still runs so the UI badge works,
 * but nothing is refused and the quota counter is never written.
 * Unknown (RPC error) is answered 503, never 403 — see checkHumanBacking.
 */
export async function checkA2aAdmission(callerAddress: string | null): Promise<A2aAdmission> {
  const enforced = a2aHumanBackingEnforced();

  if (!callerAddress) {
    if (!enforced) return { ok: true, humanBacked: null };
    return {
      ok: false,
      response: NextResponse.json(
        { error: "il nome del chiamante non pubblica un indirizzo: nessun umano ne risponde", reason: "human_backing_required" },
        { status: 403 },
      ),
    };
  }

  const lookup = await lookupHumanId(callerAddress);

  if (lookup.error) {
    if (!enforced) return { ok: true, humanBacked: null };
    return {
      ok: false,
      response: NextResponse.json(
        { error: "impossibile verificare ora il legame con un umano, riprova", detail: lookup.error },
        { status: 503 },
      ),
    };
  }

  if (!lookup.humanId) {
    if (!enforced) return { ok: true, humanBacked: null };
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "questo endpoint risponde solo ad agenti con un umano reale e unico alle spalle",
          reason: "human_backing_required",
          agentbook: { contract: agentBookAddress(), network: "eip155:480" },
          register: `${(process.env.SITE_URL ?? "https://0run.fun").replace(/\/$/, "")}/mint`,
        },
        { status: 403 },
      ),
    };
  }

  if (enforced) {
    const day = new Date().toISOString().slice(0, 10);
    const allowed = await agentkitStorage.tryIncrementUsage(`a2a:${day}`, lookup.humanId, a2aDailyQuotaPerHuman());
    if (!allowed) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "quota giornaliera per umano esaurita", reason: "quota_exhausted", humanId: lookup.humanId },
          { status: 429 },
        ),
      };
    }
  }

  return { ok: true, humanBacked: { humanId: lookup.humanId } };
}
