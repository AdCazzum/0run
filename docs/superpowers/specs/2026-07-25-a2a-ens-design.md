# ENS-native agent-to-agent consultation (A2A)

Date: 2026-07-25
Status: approved by Ivan (conversation review, all sections)

## Goal

Give 0run coaches real agent→agent communication for the ETHGlobal ENS track: during a
chat, a coach consults another coach, the cross-coach dialogue is visible to the user,
and ENS is the identity, discovery, **and authentication** layer. Messages travel
offchain over HTTP; identity, endpoints, and signer keys live onchain in ENS text
records under `0run.eth` (Sepolia).

Both coaches run on our backend for the demo, but the protocol is open: any agent that
registers a compatible subname (endpoint + signer records) could participate.

## What exists today (verified)

- Every coach already gets `<slug>.0run.eth` via the wildcard `PermissionedResolver`
  (`apps/web/src/lib/ens/subname.ts` — `assignSubname` writes `setAddr` + text records
  in one `resolver.multicall`).
- Text records follow the ENSIP-26 agent-records style: `agent-context`,
  `agent-endpoint[web]`, `0run:inft`, `avatar`.
- `/api/coach/[tokenId]/ask` is human→agent only (Privy-gated), stateless, and never
  touches private memory.
- `coachComplete` (`apps/web/src/lib/inference/index.ts`) has no tool-calling.
- No agent-owned keys, no machine-readable endpoint, no inbound auth path for agents.

## Architecture

New module `apps/web/src/lib/a2a/`: protocol types, outbound request signing, inbound
verification. Everything else reuses existing pieces (`resolveCoachEns`,
`coachComplete`, the `ask` route's profile-loading cascade — extracted into a shared
`loadConsultProfile()` in `lib/coach/`).

**Agent signer.** One deployment-level key, `A2A_SIGNER_PRIVATE_KEY` (env). Its address
is the *executor* authorized to speak for all our coaches, published in ENS. Coaches
have no wallet of their own (the ENS `addr` is the owner's Privy wallet), so ENS
records declare which key may sign on the agent's behalf. External agents would publish
their own signer under their own subname. Per-coach keys are explicitly out of scope.

**Two new text records per coach** (written in the mint flow by extending the
`records` passed to `assignSubname` — same single multicall, no extra tx — plus a
backfill script for existing coaches, reusing the idempotent `assignSubname`):

| Record | Value | Role |
|---|---|---|
| `agent-endpoint[a2a]` | `https://0run.fun/api/coach/<tokenId>/a2a` | machine-callable consult endpoint |
| `agent-signer` | address of `A2A_SIGNER_PRIVATE_KEY` | key authorized to sign messages *from* this agent |

**Two new public routes:**

- `GET /api/coach/[tokenId]/agent.json` — agent card: ENS name, personality,
  capabilities (`["coach-consult"]`), A2A endpoint, `0run:inft` pointer.
- `POST /api/coach/[tokenId]/a2a` — receives a signed consult from another agent.
  No Privy: authentication is signature verification via ENS.

The existing `ask` route (human→agent) is untouched.

## Protocol and authentication

Request payload (JSON POST to the ENS-resolved endpoint):

```json
{
  "from": "marco.0run.eth",
  "to": "pedro.0run.eth",
  "question": "...",
  "context": "non-sensitive summary of the athlete's latest run",
  "ts": 1753440000,
  "nonce": "uuid",
  "sig": "0x..."
}
```

`sig` is an EIP-191 signature (viem `personal_sign`) over the digest of
`{from, to, question, context, ts, nonce}`. Digest = the JSON serialization of those
six fields with keys in that fixed order (no whitespace); both signer and verifier
build it with the same shared helper in `lib/a2a`.

Receiver verification — ENS as the identity layer:

1. `ts` within ±5 minutes, else 401 (anti-replay; the nonce is part of the digest but
   no persistent blacklist is kept — the time window suffices for the hackathon).
2. Resolve `from` on Sepolia (`resolveCoachEns`) → read `agent-signer`.
3. `recoverAddress(digest, sig)` must equal `agent-signer`; missing record or failed
   resolution → 401.
4. `to` must equal the receiver's own ENS name (prevents replaying the message to a
   different coach).

No tokens, no sessions, no API-key table: the only registry of who may speak is ENS.

After verification the receiver loads its own coach profile via the shared cascade
(`profileCipher` → 0G Storage → public row), builds a "a fellow coach is consulting
you on behalf of their athlete — answer as a specialist, you don't know the athlete"
prompt, makes a single `coachComplete` call, and returns
`{ reply, coach: { name, ensName, personality } }`.

**Privacy:** neither side's private memory is touched (same contract as the `ask`
route). The caller never forwards the user's chat or decrypted memory — only the
model-formulated question plus, at most, the latest run stats (already plaintext in
the DB).

**Loop prevention:** the A2A route has no consult mechanism of its own — the
consultant prompt mentions no colleagues and its reply is never parsed for markers.
Max depth 1 by construction.

## Chat orchestration and UI

`coachComplete` has no tool-calling, so the chat route uses a structured marker:

1. The chat system prompt is extended with the colleague roster from
   `getCoachDirectory()` (already 60s-cached): ENS name, personality, one-line
   specialty. Instruction: *if the question benefits from a specialist opinion, emit
   `<consult coach="name.0run.eth">question for the colleague</consult>` and nothing
   else.*
2. Server parses the model output. No marker → unchanged flow.
3. Marker → resolve the name via ENS, read `agent-endpoint[a2a]`, sign and send the
   consult, then a **second** `coachComplete` call injecting the colleague's reply:
   *"pedro.0run.eth answered: «…». Now answer your athlete, integrating and crediting
   their opinion."*
4. The client response gains a `consult: { to, toAvatar, question, reply }` field
   alongside the final `reply`.

One consult per turn (first valid marker wins; others ignored). A consult turn costs
2 inference calls + 1 HTTP call.

**UI:** while waiting, a "Marco is consulting pedro.0run.eth…" indicator with both
avatars. Then a visually distinct nested "consult" block between chat bubbles:
Marco's question → Pedro's reply, each with ENS avatar and a clickable `.0run.eth`
name (links to the coach's public page), plus a "verified via ENS" badge on Pedro's
reply. The coach's final answer follows as a normal bubble.

**Persistence:** the consult is stored on the turn in `chatMessages` (JSON metadata on
the coach message) so reloading the chat re-renders the block. No new table.

**Demo determinism:** the prompt makes consulting likely for out-of-specialty
questions, and the chat UI offers an explicit affordance (e.g. an "ask … for a second
opinion" suggestion) that appends a hint the model follows reliably.

## Error handling

Principle: the consult is best-effort; the chat never breaks.

| Failure | Behavior |
|---|---|
| ENS name doesn't resolve / no `agent-endpoint[a2a]` | Skip consult; second inference with a "colleague unreachable" note → coach answers alone and says so. |
| A2A call timeout (45s budget) or HTTP ≥ 400 | Same degradation, mentioning the attempt. |
| Invalid signature / stale `ts` / wrong `to` (receiver side) | 401 with reason in the body (also useful for demo debugging). |
| Malformed marker or coach not in roster | Marker ignored; reply treated as normal. |
| Consultant inference fails | Receiver returns 502; caller degrades as above. |

The receiving A2A route is stateless and writes nothing: no dirty state on mid-flight
errors.

## Local dev / demo

ENS records contain production URLs. Locally, `A2A_ENDPOINT_OVERRIDE`
(e.g. `http://localhost:3000`) replaces the origin of the resolved endpoint, keeping
path and signature verification identical. Unset in production, so the demo uses
exactly what ENS says.

## Testing

Same style as `ask.test.ts`:

- Unit `lib/a2a`: sign→verify roundtrip; rejection for wrong signature, out-of-window
  `ts`, mismatched `to`; `<consult>` marker parsing (valid, malformed, multiple).
- Route `a2a`: ENS and inference mocked — happy path and each 401.
- Route `chat`: turn with marker → response contains `consult`; A2A call failure
  degrades without error.
- Backfill script: dry-run printing the records it would write.

## Out of scope

Persistent nonce blacklist, per-coach signer keys, multi-hop consults, real external
agents, onchain anchoring of consults (hash on 0G Storage + contract event — possible
post-demo extension).
