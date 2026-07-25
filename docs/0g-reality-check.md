# 0G Galileo — measured numbers (2026-07-25)

Real measurements taken from the treasury wallet `0x7CAd48f536fC2d23dEa4756d6C601f9C065B6877` on the Galileo testnet (chainId 16602) using Ivan's real data, not synthetic fixtures. They serve two purposes: driving architectural decisions, and giving judges defensible numbers instead of generic claims.

## Chain — works well, costs nothing

| Operation | Outcome | Cost |
|---|---|---|
| Deploy `OrunAgentNFT` + `CoachRegistry` | ✅ | 0.0076 OG total |
| `mint([IntelligentData], to)` → tokenId 1 | ✅ tx `0x28b9c02e26e8735d3ab9e474a49669069a21f0e1e6898f2cd2c05def1a24799d` | negligible |
| `CoachRegistry.update(1, memoryRoot, profileRoot)` → runCount 1 | ✅ tx `0x5d3ebbc6dbd2e35085ebc86df8bccb6e286b61b13d6b438a55a924987026d812` | negligible |

Live addresses: AgentNFT `0x3df1e8029ce2360ABdfECD0fcc966B04F76eaf9e`, CoachRegistry `0x08b3a841393ab09A4C902800C55d24e6AF66945f`. Bytecode verified with `eth_getCode`. Of the initial 6 OG, ~5.99 remain: the chain is not a constraint.

## Compute — works, ~20s, with proof of payment

Coach report on a real GPX, full prompt, `drill_sergeant` profile:

- **Valid JSON on the first attempt**, no retries: `glm-5.2`, `finish_reason: stop`
- **19.5s latency**, 1274 output tokens of which **789 were reasoning**
- `x_0g_trace`: provider `0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D`, request id `13eed4ff-2b82-4418-b241-392708839536`, on-chain input+output cost

Two consequences. First: **no need to set `max_tokens`** — the router's default budget covers even a reasoning model on full prompts (the doubt was legitimate: with `max_tokens: 20` the same model returns *empty* content because it spends everything on reasoning). Second: `x_0g_trace` is the artifact the 0G brief asks for as proof of 0G Compute usage — it belongs in the submission.

### Router vs Direct: attestation or quality, measured

| | Router (`glm-5.2`) | Direct (`qwen2.5-omni-7b`) |
|---|---|---|
| Per-response attestation | absent (TEE-acknowledged provider only) | **`processResponse` → `true`** |
| Latency | 19.5 s | **1.07 s** |
| Payment | prepaid credit on pc.0g.ai | on-chain from the treasury (4 OG ledger) |
| Coaching quality | uses the memory, stays in character: *"Same run, same numbers, zero progress. Wake up."* | **ignores the context**: *"I can't tell how you're progressing without seeing the data"* — with the data right there in the prompt |

The Direct network exposes **a single chat model** (verified with `broker.inference.listService()`: 2 services total, one is image-edit). So the choice is stark and has to be stated: the only path that cryptographically attests every response is also the one that produces the worse coach. `INFERENCE_PREFER` decides the order and the other path remains an automatic fallback, so the configuration is a product decision rather than a code constraint.

An implementation note that cost real time: the Compute SDK's **ESM build is broken** (`does not provide an export named 'C'` on 0.9.0). The CommonJS build has to be loaded via `createRequire`, otherwise enabling the Direct path fails at runtime and silently falls back to the router — i.e. it *looks* like it works for as long as the router has credit.

### The split: report on the router, effort score on direct

The table above is a stark either/or only if you treat coaching as a single call. It isn't: the product explicitly separates two outputs.

- **The narrative report** (headline, analysis, comparison, advice) stays on the **router / `glm-5.2`**: it uses the memory, stays in character, it *is* the product — behavior unchanged.
- **The 1-5 effort score** (`apps/web/src/lib/coach/score.ts`) ALWAYS goes to **direct / `qwen2.5-omni-7b`**, calling `directComplete` explicitly and never `coachComplete` — therefore independent of `INFERENCE_PREFER`. A single number derived from already-aggregated statistics is exactly what a 7B model does well, and it is also the one part someone might contest or forge: that is where tamper-proof provenance actually matters. The score is then injected into the report prompt (`buildReportMessages`) so the large model cites it instead of recomputing it.

**What the attestation proves, and what it does not.** `processResponse → true` proves that *that response* was produced by *that model* inside a TEE, on the data submitted in that request. It does not prove the GPX is genuine, nor that the aggregate statistics passed in the prompt are true — the attestation covers the inference, not the provenance of the upstream data. No copy in the product may imply otherwise.

The score is designed as **effort/intensity relative to the athlete's own history** (1 = recovery, 5 = maximal), never an absolute scale: comparing different runners on a fixed scale would be meaningless, so the prompt explicitly anchors the model to that same athlete's recent pace trend. If the direct path fails (single provider, testnet, drops often — see the table above), `scoreRun` never throws and never invents a number: it returns an `{ ok: false }` outcome that the pipeline marks as an `error` step without failing the run — the report remains the product, the score is an enrichment.

## Storage — writing works, reading doesn't (within demo time)

This is the constraint that changed the architecture.

| Measured fact | Number |
|---|---|
| Encrypted upload of a real GPX (658 KB) | tx confirmed, merkle root `0x0c173a56dc7257e398296c1d1e1636d6762e6fd024e0d32984145481e0d33a3b` |
| Availability of the freshly uploaded file | **> 22 minutes of continuous polling and still `{"code":101,"message":"File not found"}`** (measured by the controller, sampled every 20s) |
| Storage-node response during polling | `Log entry is available, but not finalized yet` (`finalized: false`) |
| Worst case observed on a second upload | `indexer.upload()` **never returned in ~24 minutes** — no SDK-internal timeout, while the on-chain tx had gone through (nonce +2, −0.002476 OG) |

### What we changed because of this

1. **The coach's memory is never re-read from Storage on the hot path.** A freshly uploaded blob is not downloadable, so the first run after mint would have failed for *every* user — including a judge trying the app from their phone. The encrypted memory is cached in the DB (AES envelope, no plaintext at rest); Storage remains the durable, verifiable copy anchored on-chain; downloading from Storage only happens on re-sync, where blobs are old and finalized.
2. **Every SDK call is now under a timeout** (upload 120s per attempt, download 30s): an indefinite hang violates the receipt-pattern promise as much as an exception does. On timeout, the error explicitly states that the on-chain submission **may still have landed** — because that is what we observed.
3. **The upload pipeline is asynchronous with visible state** (this was not just an aesthetic choice): the user watches encryption → upload → memory → tx → inference advance instead of staring at a request that looks stuck.

### What stays true in the pitch

The claim "your data lives encrypted on 0G" is verifiable regardless of read latency: the upload tx and the merkle root are public and inspectable on `storagescan-galileo.0g.ai`. What we **cannot** promise on this testnet is immediate retrieval after a write — and the demo must not depend on it. For the same reason the "kill the DB → re-sync" demo stays out: the rebuild requires Storage reads, so it is told in words with the runbook as evidence.
