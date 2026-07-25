/**
 * The negative half of the human-backed demo: an agent with a PERFECTLY VALID
 * ENS identity (subname, addr, agent-signer, correct EIP-191 signature) but
 * no human registered behind its addr in AgentBook. With
 * REQUIRE_HUMAN_BACKED_A2A=1 the consult endpoint must answer 403
 * human_backing_required — identical cryptography, different accountability.
 *
 * One-time setup (writes rogue.0run.eth on Sepolia; needs the ENS owner env):
 *   ROGUE_PRIVATE_KEY=0x… npx tsx --env-file=.env scripts/demo-rogue-agent.ts --setup
 * Demo run (POSTs a signed consult at the target coach):
 *   ROGUE_PRIVATE_KEY=0x… BASE=https://0run.fun TARGET_TOKEN_ID=2 TARGET_ENS=pedro.0run.eth \
 *     npx tsx --env-file=.env scripts/demo-rogue-agent.ts
 * Stage finale: register the rogue wallet from World App, re-run → 200 + humanBacked.
 */
import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { signConsult } from "../apps/web/src/lib/a2a/protocol";
import { assignSubname } from "../apps/web/src/lib/ens/subname";

const BASE = (process.env.BASE ?? "https://0run.fun").replace(/\/$/, "");
const ROGUE_LABEL = "rogue";
const ROGUE_NAME = `${ROGUE_LABEL}.0run.eth`;

async function main() {
  const pk = process.env.ROGUE_PRIVATE_KEY as `0x${string}` | undefined;
  if (!pk) throw new Error("ROGUE_PRIVATE_KEY mancante (una chiave qualsiasi MAI registrata in AgentBook)");
  const rogue = privateKeyToAccount(pk);

  if (process.argv.includes("--setup")) {
    // addr = the rogue wallet (unregistered), agent-signer = the same key:
    // a fully self-consistent ENS identity — that is the point of the demo.
    const result = await assignSubname(ROGUE_LABEL, rogue.address, {
      tokenId: "0",
      endpoint: `${BASE}/coach/0`,
      avatar: `${BASE}/api/coach/0/avatar`,
      a2aEndpoint: `${BASE}/api/coach/0/a2a`,
      signer: rogue.address,
      description: "Demo agent — valid ENS identity, no human backing (rogue.0run.eth)",
      url: `${BASE}/coach/0`,
      personality: "coach",
    });
    console.log("setup:", result);
    return;
  }

  const target = process.env.TARGET_ENS;
  const tokenId = process.env.TARGET_TOKEN_ID;
  if (!target || !tokenId) throw new Error("TARGET_ENS e TARGET_TOKEN_ID richiesti per la demo");

  const signed = await signConsult(
    {
      from: ROGUE_NAME,
      to: target,
      question: "How should my athlete pace a hilly marathon?",
      context: "",
      ts: Math.floor(Date.now() / 1000),
      nonce: randomUUID(),
    },
    pk,
  );

  const res = await fetch(`${BASE}/api/coach/${tokenId}/a2a`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signed),
  });
  const body = await res.json().catch(() => ({}));
  console.log(`HTTP ${res.status}`);
  console.log(JSON.stringify(body, null, 2));
  if (res.status === 403 && body.reason === "human_backing_required") {
    console.log("\n✓ demo: identità ENS valida, ma nessun umano dietro — respinto.");
  } else if (res.status === 200 && body.humanBacked) {
    console.log(`\n✓ demo: ora human-backed (humanId ${body.humanBacked.humanId}) — risponde.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
