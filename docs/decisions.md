# Technical decisions

## AgentNFT: vendoring 0gfoundation/0g-agent-nft vs the OrunAgentNFT fallback

**Date:** 2026-07-25
**Context:** Task 9 (contracts). The `0gfoundation/0g-agent-nft` repo implements ERC-7857 ("intelligent NFT") on two branches: `main` and `eip-7857-draft`. We had to choose which one to vendor for `AGENT_NFT_ADDRESS`, with this selection criterion: `mint` must match `mint(IntelligentData[] calldata, address) payable returns (uint256)` and the contract must expose `intelligentDatasOf(uint256)` as a view.

**Repos inspected (shallow clone, never in this repo's history):**
- `main` — commit `b86e108a49bf3601bf57f1f0b3166dce2cb15928` (2026-02-02)
- `eip-7857-draft` — commit `3b32a607fc9788dbd754b1f640b824083a81cdfc` (2025-05-27)

### Mint-signature evidence

**`main` — `contracts/AgentNFT.sol`:**
```solidity
function mint(IntelligentData[] calldata iDatas, address to) public payable virtual whenNotPaused returns (uint256 tokenId)
```
→ **Matches** the criterion (`IntelligentData[] calldata` + `address to`, `payable`, `returns (uint256)`).
It also exposes `intelligentDatasOf(uint256)` as `public view` (inherited from `ERC7857Upgradeable.sol:176`), with struct `IntelligentData { string dataDescription; bytes32 dataHash; }` (in `interfaces/IERC7857Metadata.sol`) — same fields as the fallback.

**`eip-7857-draft` — `contracts/AgentNFT.sol`:**
```solidity
function mint(bytes[] calldata proofs, string[] calldata dataDescriptions, address to) public payable virtual returns (uint256 tokenId)
```
→ **Does not match**: it requires an array of `proofs` (TEE/ZK preimage proofs verified by an external `IERC7857DataVerifier`) instead of `IntelligentData[]`. No `intelligentDatasOf`; it exposes separate `dataHashesOf` / `dataDescriptionsOf` instead.

**Selection conclusion:** `main` is the branch the criterion expects → proceed to vendor it.

### Presence of `authorizeUsage`

- **`main`:** yes — `authorizeUsage(uint256 tokenId, address to)` in `extensions/ERC7857AuthorizeUpgradeable.sol` (plus `batchAuthorizeUsage`, `revokeAuthorization`, `clearAuthorizedUsers`).
- **`eip-7857-draft`:** yes — `authorizeUsage(uint256 tokenId, address to)` defined directly in `AgentNFT.sol` (via the legacy `IERC7857` interface), no `revoke`.

Both branches have an "authorize usage" concept; only `main`, however, matches the rest of the required interface.

### Vendoring attempt on `main` — outcome: FAILED, vendor discarded

Steps executed:
1. `cp -r /tmp/0g-agent-nft-main/contracts contracts/contracts/vendor` (17 files: `AgentNFT.sol`, `AgentMarket.sol`, `ERC7857Upgradeable.sol`, `TeeVerifier.sol`, `Utils.sol`, `extensions/*`, `interfaces/*`, `proxy/*`, `verifiers/*`).
2. `npx hardhat compile` → failed initially: `@openzeppelin/contracts-upgradeable` missing (added `5.0.2`, pinned consistently with the vendor's original `package.json`).
3. Second failure: `TypeError: The "mcopy" instruction is only available for Cancun-compatible VMs (you are currently compiling for "paris")` in `@openzeppelin/contracts/utils/Bytes.sol` — caused by having `@openzeppelin/contracts@^5.6.1` (required by the fallback, which uses `_requireOwned`) while the vendor expected `5.0.2`. **Fix:** pin `@openzeppelin/contracts` to exactly `5.0.2` (compatible with both the vendor and the fallback, no `mcopy`/Cancun usage — also safer for compatibility with EVM chains that may not support the Cancun hard fork).
4. With that pin, `npx hardhat compile` succeeded: **53 Solidity files compiled**, but with an explicit warning:
   > `Warning: Contract code size is 24674 bytes and exceeds 24576 bytes (a limit introduced in Spurious Dragon). This contract may not be deployable on Mainnet.` (referring to `contracts/vendor/AgentNFT.sol`)
5. Wrote an adapted "spike" test (deploy behind `UpgradeableBeacon` + `BeaconProxy`, since the constructor calls `_disableInitializers()` and therefore `initialize()` cannot be called on a direct instance — a proxy is mandatory) replicating the fallback's test (`mint` with `IntelligentData[]`, verify `ownerOf` and `intelligentDatasOf`).
6. Running the spike test on the local Hardhat network (EDR, which enforces the same EIP-170 limit as mainnet): **failed at implementation deploy**, not at mint:
   ```
   Error: Transaction reverted: trying to deploy a contract whose code is too large
     at AgentNFT.constructor (contracts/vendor/AgentNFT.sol:82)
   ```

**Root cause:** `main`'s `AgentNFT.sol` simultaneously inherits `AccessControlUpgradeable`, `ReentrancyGuardUpgradeable`, `PausableUpgradeable`, `ERC7857CloneableUpgradeable`, `ERC7857AuthorizeUpgradeable`, `ERC7857IDataStorageUpgradeable` (plus `mintWithRole` in 4 overloads for `AgentMarket`, fee/creator handling, etc.) — the compiled bytecode exceeds the EIP-170 limit of 24576 bytes (24674 bytes, ~98 bytes over) even with `optimizer` + `viaIR` enabled. The contract compiles but is **not deployable** on any EVM chain enforcing the standard limit (practically all of them, presumably including 0G Galileo).

**Decision:** by the task's explicit criterion ("if the vendor compiles and its mint test passes, use the vendor" — here it compiles but mint/deploy does **not** pass), the vendor is **discarded**. The `contracts/contracts/vendor/` folder was removed from the repo after the experiment (never committed). `OrunAgentNFT.sol` is **authoritative for the MVP**.

**Possible future paths** (out of MVP scope, noted only): refactor the vendor removing `AgentMarket`/fee-distribution/creator-tracking not needed for the MVP, or use `mintWithRole`/split into multiple contracts to stay under 24KB; or wait for possible upstream slimming. Neither was attempted, to respect the timebox.

### Final state

- `AGENT_NFT_ADDRESS` → deployment of `OrunAgentNFT.sol` (fallback, ERC-7857-style subset: `mint`, `intelligentDatasOf`, `ownerOf`, `authorizeUsage`).
- `@openzeppelin/contracts` pinned to exactly `5.0.2` in `contracts/package.json` (not `^5.6.1`) to avoid the `mcopy`/Cancun dependency in `Strings.sol`/`Bytes.sol`, while keeping `_requireOwned` (introduced in OZ 5.0).
- No deploy executed on `zgTestnet` (unfunded wallet, per the controller's amendment). `contracts/scripts/deploy.ts` is ready and verified only on the local in-memory Hardhat network.
- `AGENT_NFT_ADDRESS` / `COACH_REGISTRY_ADDRESS` in `.env` remain to be filled when the real deploy to Galileo happens (out of this task's scope).

## Real deploy to Galileo + 0G Storage/inference spike (real data)

**Date:** 2026-07-25
**Context:** treasury `0x7CAd48f536fC2d23dEa4756d6C601f9C065B6877` funded with 6 OG. Real deploy executed, on-chain sanity checks, storage and inference spikes with real data (not mocks).

### A. Contract deploy (`zgTestnet` network, chainId 16602)

| Contract | Address | Explorer |
|---|---|---|
| `OrunAgentNFT` (`AGENT_NFT_ADDRESS`) | `0x3df1e8029ce2360ABdfECD0fcc966B04F76eaf9e` | https://chainscan-galileo.0g.ai/address/0x3df1e8029ce2360ABdfECD0fcc966B04F76eaf9e |
| `CoachRegistry` (`COACH_REGISTRY_ADDRESS`) | `0x08b3a841393ab09A4C902800C55d24e6AF66945f` | https://chainscan-galileo.0g.ai/address/0x08b3a841393ab09A4C902800C55d24e6AF66945f |

Both written to `.env`. `eth_getCode` confirmed non-empty on both at deploy time.

Deploy txs:
- `OrunAgentNFT`: `0x787a4b08b2d02e536df79c0461e3c09aaacc73886f83405053e90d94d262c943` (block 45803362, gasUsed 1176655) — https://chainscan-galileo.0g.ai/tx/0x787a4b08b2d02e536df79c0461e3c09aaacc73886f83405053e90d94d262c943
- `CoachRegistry`: `0x4a125c951f3608a5c350eaf60380df46c23a74a751773a031925ecbcb14964a5` (block 45803377, gasUsed 180410) — https://chainscan-galileo.0g.ai/tx/0x4a125c951f3608a5c350eaf60380df46c23a74a751773a031925ecbcb14964a5

Sanity calls from the treasury signer (which coincides with the deployer/backend):
- `CoachRegistry.update(1, keccak256("m1"), keccak256("p1"))` → tx `0x5d3ebbc6dbd2e35085ebc86df8bccb6e286b61b13d6b438a55a924987026d812` (block 45803643, gas 90884). Reading `memoryOf(1)`: `memoryRoot=0x83267a439473d40c510063b30f7c06d1e3bf496ea5e34c5e3290dfc7dc527ce1`, `profileRoot=0x260e065801cba6ca065f28640c3d94ef235f67db5431448aae1a51af7214efaf`, `runCount=1` ✓ (assertion passed).
- `OrunAgentNFT.mint([{dataDescription:"0g://storage/0xtest", dataHash:keccak256("ct")}], treasury)` → tx `0x28b9c02e26e8735d3ab9e474a49669069a21f0e1e6898f2cd2c05def1a24799d` (block 45803672, gas 144114), `tokenId=1`. `intelligentDatasOf(1)` matches, `ownerOf(1)==treasury` ✓ (assertions passed).
- Combined update+mint cost: 0.000939992001644986 OG (balance 5.994571739990500545 → 5.993631747988855559).

### B. 0G Storage spike — real round trip: BLOCKED on finality, not faked

A throwaway script (`/tmp`, never committed) imported `apps/web/src/lib/zerog/storage.ts` directly (no changes to the file) and called `uploadEncrypted()` on a real GPX fixture (`scripts/fixtures/real/20260721-093240-Running-21-7-2026-10-32-6765CE8D.gpx`, 658359 bytes) with a random 32-byte symmetric key.

**Evidence of a real on-chain submission** (not fabricated):
- Treasury nonce: 4 → 6 (2 txs mined) during the upload window.
- Treasury balance: 5.993631747988855559 → 5.991155480096399 OG (delta **-0.002476267892456363 OG**, entirely attributable to the upload — no other activity in between).
- `dataMerkleRoot` observed stably for the whole window (~24 minutes) in the SDK's internal debug trace, and **reconfirmed with a direct `zgs_getFileInfo` call to the storage node** (`http://34.83.53.209:5678`) at the time this report was written: `rootHash = 0x2bd3d835b4b8b681949495646ef5703002ac6f1a0df25be28c176d48541994c4`, `size=658376` bytes (== 658359 raw + 17-byte SDK encryption header, matches).
- `finalized: false` in **every** observation, including the final direct one.

**Outcome:** `uploadEncrypted()` **never returned** (neither `ok:true` nor `ok:false`) within ~24 minutes of real wall-clock time. Root cause: `Uploader.waitForLogEntry()` in the SDK (`node_modules/@0gfoundation/0g-storage-ts-sdk/lib.esm/transfer/Uploader.js`, function `waitForLogEntry`) polls every 1s in a `while(true)` **with no retry cap** when `finalityRequired` is true — so our `doUpload`/`uploadEncrypted` stays blocked until the storage node reports `finalized:true`, which on the real Galileo network did not happen within this window. The background process was eventually killed by the harness (~24 min).

Consequently:
- **No `txHash` captured** from the function's return value (it never returned `ok:true`).
- **`downloadDecrypted()` never attempted** (per explicit instruction: don't wait indefinitely and don't invent results).
- **Byte-identity verification not performed.**
- Reference storage-explorer URL (probably not yet indexed, given `finalized:false`): https://storagescan-galileo.0g.ai/file?root=0x2bd3d835b4b8b681949495646ef5703002ac6f1a0df25be28c176d48541994c4

**Critical demo risk (follow-up required for whoever owns `apps/web`):** any application flow that calls `uploadEncrypted()` synchronously/blockingly (e.g. inside an HTTP request) risks hanging for **20+ minutes** on the real network, with no SDK-side timeout. Recommendation: decouple the upload from request/response (fire-and-forget + separate job/poll with an explicit app-side timeout); do not rely on `uploadEncrypted()`'s synchronous return for the user experience in a live demo.

### C. Inference spike — real round trip: SUCCESS on the first attempt

A throwaway script used `apps/web/src/lib/gpx/parse.ts` to parse a real GPX fixture (`scripts/fixtures/real/20260722-104118-Running-22-7-2026-11-41-A0DDBE46.gpx` → 9.969 km, 3968s, average pace 398 sec/km, 9 splits, no HR), built the messages with `buildReportMessages()` for a `drill_sergeant` profile (with 2 synthetic previous runs as comparison context), and called `completeJson(ReportSchema, messages, retries=2)` from the real service `apps/web/src/lib/inference` (no code changes; `x_0g_trace`/billing captured by intercepting `fetch` from outside, since `CoachCompletion` doesn't expose them).

- **Valid JSON on the first attempt** (`attempts=1`, no retry needed).
- Model: `glm-5.2` (via `router`), total latency **19465 ms**.
- Tokens: `prompt_tokens=483`, `completion_tokens=1274` (of which `reasoning_tokens=789`), `total_tokens=1757`. `finish_reason: "stop"` (not truncated).
- `x_0g_trace`: `provider=0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D`, `request_id=13eed4ff-2b82-4418-b241-392708839536`, `billing={input_cost:"2516430000000000", output_cost:"22154860000000000", total_cost:"24671290000000000"}` (wei-like unit, `total_cost` ≈ 0.02467129 in that unit).
- **No follow-up needed for `max_tokens`**: `routerComplete` sends no `max_tokens` and, on this real prompt (full report with historical comparison), the router's default budget was sufficient — `finish_reason=stop`, complete content received, JSON extracted and validated on the first shot. A theoretical residual risk remains for much longer/more complex prompts (not observed in this run), but it is not an observed real blocker.

### Updated final state

- Part A (deploy + on-chain sanity): **complete**, all assertions passed.
- Part B (real storage round trip): **blocked on network finality** after ~24 minutes of real waiting — not a bug in our code, genuine Galileo/SDK network behavior observed and reconfirmed with a direct call. No invented data.
- Part C (real inference): **complete**, valid JSON on the first attempt, payment traceability (`x_0g_trace`) captured.

## RunEvents — permissionless events with co-signed claims (Plan B, Task 1)

**Date:** 2026-07-25
**Context:** `contracts/contracts/RunEvents.sol` implements events anyone can create (`createEvent`) and claims gated by World ID: the contract does not verify the proof on-chain (no `WorldIDRouter` on 0G), so it trusts only a signature from the `backend` (= treasury) produced after a server-side cloud verify. TDD followed: test written first, RED confirmed (`HH700: Artifact for contract "RunEvents" not found`), then implementation, GREEN 4/4, full `npx hardhat test` 6/6 (the 2 pre-existing `OrunAgentNFT`/`CoachRegistry` tests stay green, no regressions).

### Co-signed digest (must be byte-identical Solidity ↔ backend)

Solidity (`RunEvents.claim`):
```solidity
bytes32 digest = keccak256(abi.encodePacked(eventId, msg.sender, nullifierHash));
require(MessageHashUtils.toEthSignedMessageHash(digest).recover(backendSig) == backend, "bad signature");
```

Backend/off-chain (identical, to be used in Task 2 for the `/api/events/:id/claim` API):
```ts
const digest = ethers.solidityPackedKeccak256(
  ["uint256", "address", "bytes32"], [eventId, claimant, nullifierHash],
);
const backendSig = await treasuryWallet.signMessage(ethers.getBytes(digest));
```

### Deploy choice: dedicated script instead of the full `deploy.ts`

`contracts/scripts/deploy.ts` was extended to also deploy `RunEvents(deployer.address)` (for future consistency and full from-scratch deploys), but the real deploy to Galileo for this task was executed with a separate script, `contracts/scripts/deployRunEvents.ts`, which deploys **only** `RunEvents`. Reason: the full `deploy.ts` would also have redeployed `OrunAgentNFT` and `CoachRegistry`, already live in production — `CoachRegistry` currently backs a real coach at `tokenId 3`; redeploying it would have orphaned that coach. The existing addresses in `.env` (`AGENT_NFT_ADDRESS`, `COACH_REGISTRY_ADDRESS`) **were not touched**; only `RUN_EVENTS_ADDRESS` was added.

### Deploy (`zgTestnet` network, chainId 16602)

| Contract | Address | Explorer |
|---|---|---|
| `RunEvents` (`RUN_EVENTS_ADDRESS`) | `0x1D66dd7C7b3f4228f7816Eb266fDCaeF49Cd89bE` | https://chainscan-galileo.0g.ai/address/0x1D66dd7C7b3f4228f7816Eb266fDCaeF49Cd89bE |

- Deploy tx: `0xce5f40e6d1f858259a506280427badcafe518ed7402671fe68acec3fbfb4e0db` (deployer/backend `0x7CAd48f536fC2d23dEa4756d6C601f9C065B6877`, gasUsed 864691, status 1) — https://chainscan-galileo.0g.ai/tx/0xce5f40e6d1f858259a506280427badcafe518ed7402671fe68acec3fbfb4e0db
- `eth_getCode` confirmed non-empty post-deploy (bytecode length 7302 hex chars, prefix `0x60808060`), tx receipt read directly via `eth_getTransactionReceipt` (block 45876341, status 1).

### Real proof of the signature round trip (Solidity ↔ backend), not just mocks

A throwaway script in `/tmp` (never committed), run with only the treasury key (which coincides with the contract's `backend`, so it acts as both creator and claimant here):

1. `createEvent("Real claim round-trip test", now-60, now+3600, "ipfs://real-test")` → tx `0x3fafabc6873f9d000e38728232810afcbe954994d3988efd03222afa917a1b64` (status 1), `eventId = 1`.
2. Nullifier `keccak256("real-claim-nullifier-<timestamp>")`, digest computed script-side with `ethers.solidityPackedKeccak256(["uint256","address","bytes32"], [eventId, claimant, nullifierHash])`, signed with `treasury.signMessage(ethers.getBytes(digest))` — exactly the formula from the test and from the `sign()` the backend will use in Task 2.
3. `claim(eventId, nullifierHash, backendSig)` → tx `0x6319915f23eaa4cab1c66641002fdde7190df7518dd1170f0ad2f7e7faa8854a` (status 1).
4. Post-tx verification: `hasClaimed(1, treasury) == true`, `claimantsOf(1) == [treasury.address]`.

**Outcome: SUCCESS.** No `"bad signature"` revert — the Solidity digest and the backend digest match byte-for-byte against the actually deployed contract, not just in the local Hardhat test mocks.

## ERC-8004 IdentityRegistry — registering the coach agent (Plan B, Task 4)

**Date:** 2026-07-25
**Context:** every minted coach is also registered on the ERC-8004 IdentityRegistry, already deployed on Galileo (not our contract). The 0G brief explicitly mentions "Agentic ID" and is ERC-8004-compatible: this task covers that deliverable at near-zero cost.

### ABI source — NOT guessed

A wrong ABI only fails at runtime on-chain, so the interface was established BEFORE writing code, from three independent sources:

1. **Reference implementation** shallow-cloned into `/tmp` (never committed): `github.com/erc-8004/erc-8004-contracts` (commit `68fc676`, "Merge pull request #83 from Wilbert957/feat/add-0g-mainnet"). Relevant files: `contracts/IdentityRegistryUpgradeable.sol`, `abis/IdentityRegistry.json`.
2. That repo's `README.md` explicitly lists a **"0G Galileo Testnet"** section with the same addresses already provided in the plan — independent confirmation this is the right deployment:
   - IdentityRegistry `0x8004A818BFB912233c491871b3d84c89A494BD9e`
   - ReputationRegistry `0x8004B663056A597Dffe9eCcC1965A193B7388713`
3. **Live cross-check** against the bytecode actually deployed on Galileo, read-only (`eth_call`, no gas spent), from a throwaway script in `/tmp`:
   - `eth_getCode` non-empty on both addresses (262 hex chars — UUPS proxy pattern, consistent with `IdentityRegistryUpgradeable`).
   - `getVersion()` → `"2.0.0"` — matches the source.
   - `name()` → `"AgentIdentity"`, `symbol()` → `"AGENT"` — match the ERC-721 source.
   - `register(agentURI, metadata).staticCall({from: treasury})` → returned `agentId = 148` **without reverting**, confirming that the selector called by this file is exactly the one implemented by the deployed bytecode (not just by the source on GitHub).

### Exact signature used

```solidity
struct MetadataEntry { string metadataKey; bytes metadataValue; }
function register(string memory agentURI, MetadataEntry[] memory metadata) external returns (uint256 agentId);
event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
```

Implemented in `apps/web/src/lib/erc8004/register.ts` as:

```ts
const IDENTITY_REGISTRY_ABI = [
  "function register(string agentURI, tuple(string metadataKey, bytes metadataValue)[] metadata) returns (uint256 agentId)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
];
export async function registerAgent(tokenId: string, agentUri: string): Promise<{agentId:string;txHash:string}|{error:string}>
```

`registerAgent` never throws (same discipline as `lib/zerog/storage.ts`) and is never on the mint request path: it fires in the background from `apps/web/src/app/api/coach/mint/route.ts`, in the same fire-and-forget lane as the Storage upload, after the on-chain mint is already confirmed. The coach's `tokenId` (from `OrunAgentNFT`, a separate contract — see `lib/zerog/contracts.ts`) is written as **on-chain** metadata (`"0run.tokenId"`) via the 3-argument overload, so the two identities are linkable on-chain and not just by URL convention. `agentId` is persisted on `coaches.agent_id` (additive nullable column).

### Real registration on Galileo — not just mocks

A throwaway script in `/tmp` (never committed) imported `apps/web/src/lib/erc8004/register.ts` directly (no changes to the file) and called `registerAgent("3", "https://0run.fun/coach/3")` with only the treasury key (`0x7CAd48f536fC2d23dEa4756d6C601f9C065B6877`).

- Tx: [`0x8b571001e567be0bb27c8650fc819b3fcb1e5dea54f9ed1057c634fa6fde9c40`](https://chainscan-galileo.0g.ai/tx/0x8b571001e567be0bb27c8650fc819b3fcb1e5dea54f9ed1057c634fa6fde9c40) (status 1, block 45877805, gasUsed 162727).
- **`agentId = 148`**.
- Post-tx read verification, with direct and independent `eth_call`s (not just the return value of the function that was called):
  - `ownerOf(148)` == treasury ✓
  - `tokenURI(148)` == `"https://0run.fun/coach/3"` ✓ (the passed URI was written correctly)
  - `getMetadata(148, "0run.tokenId")` UTF-8 decodes to `"3"` ✓ (the on-chain link between the two identities works)

**Outcome: SUCCESS.** No reverts, no guessed ABIs — the interface used was confirmed against the source, against the 0G deployment README, and against the bytecode actually running on Galileo before `register.ts` was even written.

## ENS identity for the coach agent — live subname on Sepolia (Plan B, Task 3)

**Date:** 2026-07-25
**Context:** every minted coach receives `<slug>.0run.eth` on Sepolia (ENS does not exist on 0G — a separate network, declared as such in the UI), with ENSIP-26 text records (`agent-context`, `agent-endpoint[web]`) plus a custom `0run:inft` key (`chainId:contract:tokenId`) pointing back to the real on-chain agent. The ENS brief explicitly requires "no hard-coded values": `resolveCoachEns()` performs a real `eth_call` on every invocation, with no cache and no fake fallbacks (see `apps/web/src/lib/ens/resolve.ts` and its dedicated test proving an empty result — never a placeholder — when the RPC client rejects).

### Assignment mechanism — NOT NameWrapper, NOT ENSRegistry: established by probing the chain, not guessed

The plan assumed a binary "0run.eth is either wrapped in NameWrapper or not", to be checked by reading `owner()` on the registry. Reality turned out more interesting:

1. **Probe 1 — canonical ENS Registry** (`0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`, same address on mainnet and Sepolia): direct `eth_call` (not through viem, to rule out any high-level interpretation) of `owner(namehash("0run.eth"))` and `resolver(namehash("0run.eth"))` → **both return the zero address**. For comparison, `owner(namehash("eth"))` and `owner(namehash(""))` return sensible addresses (the `.eth` Base Registrar and the Sepolia root controller), so the registry and the address used are correct — it is specifically the `0run.eth` node that has no entry in the base registry. This rules out *both* `NameWrapper.setSubnodeRecord` *and* `ENSRegistry.setSubnodeRecord`: both require `msg.sender == owner(node)`, and here `owner(node)` is `address(0)` — a condition no real signer can satisfy.
2. **Yet live resolution works** (confirmed by the controller and re-verified here): viem's `publicClient.getEnsAddress/getEnsText({name: "0run.eth"})` (ENSIP-10 actions based on `UniversalResolver`) answer correctly. The resolver returned by `getEnsResolver` is a 78-byte EIP-1167 minimal-proxy contract (`0x4C67b8fb2e6e004dB644919fAEe12dcDDD59354f`).
3. **Implementation identified** via Blockscout Sepolia's verified-source API (`GET /api/v2/smart-contracts/<implementation>`, no key required): the proxy points at `0x917c561a74df398646e06f3ffaa51db8e8330c5`, source verified as **`PermissionedResolver`** — the new-generation resolver from the official `@ens/contracts` monorepo, with role-based permissions (`EnhancedAccessControl`) instead of classic registry ownership. Records live in a flat `node => Record` map **inside the resolver itself**: no separate subname "registration" is needed — being able to call `setAddr`/`setText` with that namehash is enough, provided you hold the right role.
4. **Verified on-chain who holds the permissions**: `resource(node, part) = keccak256(node, part)`; roles granted on `ROOT_RESOURCE` (the `0x0` resource, assigned to the admin in `initialize(admin, roleBitmap)`) act as a fallback for **any** other resource on the same resolver (`EnhancedAccessControl.hasRoles`: `(_roles[ROOT_RESOURCE][account] | _roles[resource][account]) & roleBitmap == roleBitmap`). Direct read: `roles(ROOT_RESOURCE, ENS_OWNER_ADDRESS)` on this resolver → **all-ones** bitmap (full admin); `hasRootRoles(ROLE_SET_ADDR | ROLE_SET_TEXT, ENS_OWNER_ADDRESS)` → `true`. So `ENS_OWNER_ADDRESS` can write records for **any** namehash served by this resolver, subnames included, with no separate "creation" transaction — ENSIP-10 wildcard resolution (this same resolver answers `resolve()` for the entire `*.0run.eth` subtree) is what makes a record keyed by a subname's namehash resolve for that subname at all.

**Implementation** (`apps/web/src/lib/ens/subname.ts`): `assignSubname(label, owner, records)` looks up `0run.eth`'s resolver **live** (`getEnsResolver` — never a hard-coded address, so the integration survives a possible resolver migration), then calls `resolver.multicall([setAddr, setText×3])` in a single transaction signed by `ENS_OWNER_PRIVATE_KEY`.

### Real assignment on Sepolia — not just mocks

A throwaway script in `/tmp` (never committed) imported `apps/web/src/lib/ens/subname.ts` and `apps/web/src/lib/ens/resolve.ts` directly (no changes to the files). First a smoke test on a throwaway label (`zzz-probe-test.0run.eth`, verified to resolve correctly and then left on Sepolia testnet — no cost, no harm), then the real assignment required for the production coach:

- `assignSubname("pedro", "0x7AEa10Ebc47CC8F2eb359B2e19a6286Ef36A59e6", { tokenId: "3", endpoint: "https://0run.fun/coach/3" })` → tx [`0xefe5ae1cc43feaa045ff5227b6a59aa0e32156fff8ff5960febcfc5fb57278e2`](https://sepolia.etherscan.io/tx/0xefe5ae1cc43feaa045ff5227b6a59aa0e32156fff8ff5960febcfc5fb57278e2) (status 1, block 11347170, gasUsed 293642, `to` = `0run.eth`'s resolver found live).
- **Independent** read verification, via `resolveCoachEns("pedro.0run.eth")` (the same production module the UI badge uses):
  ```json
  {
    "address": "0x7AEa10Ebc47CC8F2eb359B2e19a6286Ef36A59e6",
    "records": {
      "agent-context": "0run running coach — intelligent NFT #3 on 0G Galileo, encrypted memory across every run",
      "0run:inft": "16602:0x3df1e8029ce2360ABdfECD0fcc966B04F76eaf9e:3",
      "agent-endpoint[web]": "https://0run.fun/coach/3"
    }
  }
  ```
- Anti-hard-coding counter-proof: `resolveCoachEns("this-definitely-does-not-exist-zzz.0run.eth")` (a name never assigned) → `{"address": null, "records": {}}`, not an invented value.

**Outcome: SUCCESS.** `pedro.0run.eth` resolves live, to the user's embedded wallet address, with all three text records written and with `0run:inft` pointing exactly at `chainId 16602 : AgentNFT 0x3df1e8029ce2360ABdfECD0fcc966B04F76eaf9e : tokenId 3` — the real agent already minted on 0G Galileo.
