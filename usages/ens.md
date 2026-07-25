# ENS usage map

Every ENS integration in 0run, mapped to the exact code and to the on-chain evidence. ENS lives on **Sepolia** (chainId 11155111) — a separate, public testnet from the coach's own chain (0G Galileo, chainId 16602) — and that separation is declared everywhere it's visible, never hidden.

## Live identity — every coach gets a name, resolved fresh, never hard-coded

| What | Where |
|---|---|
| Live resolution over Sepolia RPC (`getEnsAddress`/`getEnsText`, ENSIP-26 keys) | `apps/web/src/lib/ens/resolve.ts` — `resolveCoachEns(name)` |
| Subname creation + record writes | `apps/web/src/lib/ens/subname.ts` — `assignSubname(label, owner, records)` |
| Public, unauthenticated resolution bridge (resolution needs server-only env + a real RPC call, so it can't run in the browser) | `apps/web/src/app/api/ens/resolve/route.ts` |
| Non-blocking assignment after every mint (fire-and-forget background lane, same discipline as the ERC-8004 step and the Storage upload) | `apps/web/src/app/api/coach/mint/route.ts` — `startBackgroundEns` |
| Live badge in the UI, re-resolves on every mount, renders nothing if resolution comes back empty | `apps/web/src/components/coach/ens-badge.tsx`, wired into `apps/web/src/app/dashboard/page.tsx` |
| Persisted pointer (nullable, additive) | `apps/web/src/db/schema.ts` — `coaches.ensName` |

Deployed identity, verified live: [`pedro.0run.eth`](https://sepolia.app.ens.domains/pedro.0run.eth) resolves to `0x7AEa10Ebc47CC8F2eb359B2e19a6286Ef36A59e6` (the coach's own embedded wallet). Assignment tx: [`0xefe5ae1cc43feaa045ff5227b6a59aa0e32156fff8ff5960febcfc5fb57278e2`](https://sepolia.etherscan.io/tx/0xefe5ae1cc43feaa045ff5227b6a59aa0e32156fff8ff5960febcfc5fb57278e2) on Sepolia.

**No hard-coded values, and this is tested, not just claimed:** `resolveCoachEns` makes a real `eth_call` every time it's invoked — no cache, no constant, no fallback string. `apps/web/src/lib/ens/resolve.test.ts` mocks the viem client at exactly the boundary where a shortcut would be tempting, and asserts that a rejecting client returns `{address: null, records: {}}`, never an invented value. The same property holds live: `resolveCoachEns("this-definitely-does-not-exist-zzz.0run.eth")` against real Sepolia RPC returns the identical empty shape — see `docs/decisions.md` for the full trace. In the UI, `EnsBadge` re-fetches on every mount and renders nothing until resolution comes back with a real address; clear the on-chain record and the badge disappears on reload, it does not fall back to a cached or remembered name.

## The record schema — ENSIP-26 plus a pointer back to the exact on-chain agent

| Key | Value | Purpose |
|---|---|---|
| `agent-context` | e.g. `"0run running coach — intelligent NFT #3 on 0G Galileo, encrypted memory across every run"` | ENSIP-26 human/agent-readable description of what this name identifies |
| `agent-endpoint[web]` | `https://0run.fun/coach/<tokenId>` | ENSIP-26 web endpoint — the same public coach page ERC-8004's `agentURI` points at |
| `0run:inft` | `"16602:0x3df1e8029ce2360ABdfECD0fcc966B04F76eaf9e:<tokenId>"` (`chainId:contract:tokenId`) | 0run-specific: ties the ENS name to the *exact* ERC-7857-style iNFT minted on 0G — not just "some coach", but this specific on-chain token |

## Mechanism — established by probing the chain, not assumed

The obvious assumption — "0run.eth is either a plain ENSRegistry-owned 2LD or wrapped in the NameWrapper" — turned out to be wrong for this specific name, and the wrong path would have failed silently at the first `setSubnodeRecord` call. What's actually true, confirmed with raw `eth_call`s and Blockscout's verified-source API (full trail in `docs/decisions.md`):

- The canonical ENS Registry's `owner()`/`resolver()` for `namehash("0run.eth")` both read back the **zero address** — the name has no entry in the base Registry at all, so neither `NameWrapper.setSubnodeRecord` nor `ENSRegistry.setSubnodeRecord` apply (both require `msg.sender == owner(node)`, and here `owner(node)` is unowned by anyone).
- Resolution instead goes through ENSIP-10 wildcard resolution to a per-name resolver clone, verified as `PermissionedResolver` (from the official `@ens/contracts` monorepo) — a role-gated resolver that stores records in a flat `node => record` map. `ENS_OWNER_ADDRESS` holds full admin roles on that resolver (verified: `hasRootRoles` reads back `true` for every role checked), so `assignSubname` writes `setAddr`/`setText` for the subname's namehash directly, with **no separate subname-registration transaction** — the resolver address itself is looked up live via `getEnsResolver`, never hardcoded.

## Not used, and why

**NameWrapper / ENSRegistry.setSubnodeRecord** were the first thing tried, per the ENS docs' description of how .eth subnames normally work — abandoned only after the on-chain probe above showed `0run.eth` has no Registry entry to create a child under. Wiring in a mechanism the chain itself proves doesn't apply here would have been indistinguishable from a silent failure at demo time.
