# 0run — Piano B: eventi, World ID, ENS, ERC-8004 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere al ciclo core il grafo sociale attestato (eventi creabili da chiunque, claim gated da World ID), l'identità dell'agente (subname ENS con text record ENSIP-26 + registrazione ERC-8004), e il badge coach autodichiarato — cioè tutto ciò che rende eleggibili i track ENS e World oltre a rinforzare il track 0G.

**Architecture:** Un contratto `RunEvents` su Galileo per eventi e claim; il backend co-firma il claim solo dopo un cloud-verify World ID riuscito (verify on-chain è impossibile su 0G: nessun WorldIDRouter deployato). L'identità ENS vive su Sepolia (ENS non esiste su 0G) e viene risolta live in UI. La registrazione ERC-8004 usa registri **già deployati** su Galileo, quindi non richiede contratti nostri.

**Tech Stack:** Solidity 0.8.28 + Hardhat (già configurato), `@worldcoin/idkit` (widget + `hashSignal`), World Developer API v4 (`developer.world.org/api/v4/verify/{rp_id}`), `@worldcoin/agentkit` (AgentBook `lookupHuman`), viem per la risoluzione ENS su Sepolia, ethers v6 per i contratti.

## Global Constraints

- Riusare tutto il ciclo core: `requireUser`, il design system (palette cream/navy/peach/ocean/orange, radius 0, Playfair+Inter, transizioni ≥500ms), il receipt pattern, `git commit <paths>` (indice condiviso).
- ChainId **16602** solo da `GALILEO` in `@0run/shared`. ENS su **Sepolia** (chainId 11155111) — rete separata, va dichiarata come tale ai giudici, non nascosta.
- World ID: **cloud-verify obbligatorio lato server** con check `success === true` **strict**. Nessuna backdoor di bypass (il repo di riferimento `provenance-miniapp` ne aveva una: non copiarla). Non loggare mai le proof.
- **Signal binding**: il signal della proof World è `hash(eventId + wallet)` — la proof è legata a quel claim specifico e non è riusabile altrove.
- Anti-replay del nullifier in **Postgres con UNIQUE** su `(eventId, nullifierHash)`, non su file (l'anti-pattern di `provenance-miniapp`).
- Trust model dichiarato in UI: gli eventi sono creabili da chiunque, quindi il claim prova **una persona reale unica per evento**, non la partecipazione. Il badge coach dice **"autodichiarato"**. Mai un "verified" che non abbiamo guadagnato.
- Registri ERC-8004 già live su Galileo: IdentityRegistry `0x8004A818BFB912233c491871b3d84c89A494BD9e`, ReputationRegistry `0x8004B663056A597Dffe9eCcC1965A193B7388713`.
- Serve World App con identità verificata sul telefono di chi fa la demo: **testare il flusso completo prima di domenica**, non il giorno stesso.
- Vincolo logistico ENS: demo funzionante senza valori hard-coded **e presenza fisica al booth ENS domenica mattina** — assegnare una persona.

## File Structure

```
contracts/contracts/RunEvents.sol            → eventi + claim con co-firma backend
contracts/test/runEvents.test.ts             → test locali
apps/web/src/lib/world/verify.ts             → cloud-verify v4 + rp-context signing
apps/web/src/app/api/world/rp-context/route.ts
apps/web/src/app/api/events/route.ts         → create + list
apps/web/src/app/api/events/[id]/claim/route.ts
apps/web/src/lib/ens/resolve.ts              → risoluzione live su Sepolia
apps/web/src/lib/ens/subname.ts              → assegnazione subname + text record
apps/web/src/lib/erc8004/register.ts         → registrazione agent id
apps/web/src/app/events/page.tsx             → lista + creazione
apps/web/src/app/events/[id]/page.tsx        → dettaglio + claim + crew
apps/web/src/components/crew/*               → card crew, badge coach
apps/web/src/db/schema.ts                    → events, claims, coachClaims (additivo)
```

**Ordine di build e cut-line:** T1→T2 (eventi+World) sono il cuore del track World e vanno per primi; T3 (ENS) è indipendente e vale $1.5k a ~4h; T4 (ERC-8004) è quasi gratis e rinforza il deliverable 0G; T5 (badge coach) è l'ultimo e si taglia senza danni. Se il tempo finisce, si taglia dal fondo.

---

### Task 1: Contratto RunEvents + claim co-firmato

**Files:**
- Create: `contracts/contracts/RunEvents.sol`, `contracts/test/runEvents.test.ts`
- Modify: `contracts/scripts/deploy.ts` (aggiungere il deploy di RunEvents)

**Interfaces:**
- Consumes: nulla dal ciclo core (contratto autonomo).
- Produces: `createEvent(string name, uint64 startsAt, uint64 endsAt, string uri) returns (uint256 eventId)` aperto a tutti; `claim(uint256 eventId, bytes32 nullifierHash, bytes backendSig)`; `hasClaimed(uint256 eventId, address who) view returns (bool)`; `claimantsOf(uint256 eventId) view returns (address[])`; eventi `EventCreated(uint256,address,string)` e `Claimed(uint256,address,bytes32)`. Indirizzo in `.env` come `RUN_EVENTS_ADDRESS`.

- [ ] **Step 1: Write the failing test**

`contracts/test/runEvents.test.ts`:

```ts
import { expect } from "chai";
import { ethers } from "hardhat";

describe("RunEvents", () => {
  async function setup() {
    const [backend, alice, bob] = await ethers.getSigners();
    const ev = await (await ethers.getContractFactory("RunEvents", backend)).deploy(backend.address);
    const now = Math.floor(Date.now() / 1000);
    await ev.connect(alice).createEvent("EthLisbon Morning Run", now - 60, now + 3600, "ipfs://x");
    return { ev, backend, alice, bob, eventId: 1n };
  }

  // Il backend firma (eventId, claimant, nullifier): solo una proof World verificata
  // lato server produce questa firma, quindi il contratto non deve fidarsi del chiamante.
  async function sign(backend: any, eventId: bigint, claimant: string, nullifier: string) {
    const digest = ethers.solidityPackedKeccak256(
      ["uint256", "address", "bytes32"], [eventId, claimant, nullifier],
    );
    return backend.signMessage(ethers.getBytes(digest));
  }

  it("chiunque crea eventi; il claim con firma valida registra il partecipante", async () => {
    const { ev, backend, bob, eventId } = await setup();
    const nul = ethers.keccak256(ethers.toUtf8Bytes("nullifier-bob"));
    const sig = await sign(backend, eventId, bob.address, nul);
    await expect(ev.connect(bob).claim(eventId, nul, sig)).to.emit(ev, "Claimed").withArgs(eventId, bob.address, nul);
    expect(await ev.hasClaimed(eventId, bob.address)).to.equal(true);
    expect(await ev.claimantsOf(eventId)).to.deep.equal([bob.address]);
  });

  it("rifiuta una firma non del backend", async () => {
    const { ev, alice, bob, eventId } = await setup();
    const nul = ethers.keccak256(ethers.toUtf8Bytes("n2"));
    const badSig = await sign(alice, eventId, bob.address, nul); // firmata da alice, non dal backend
    await expect(ev.connect(bob).claim(eventId, nul, badSig)).to.be.revertedWith("bad signature");
  });

  it("rifiuta il riuso dello stesso nullifier sullo stesso evento", async () => {
    const { ev, backend, alice, bob, eventId } = await setup();
    const nul = ethers.keccak256(ethers.toUtf8Bytes("shared"));
    await ev.connect(bob).claim(eventId, nul, await sign(backend, eventId, bob.address, nul));
    await expect(
      ev.connect(alice).claim(eventId, nul, await sign(backend, eventId, alice.address, nul)),
    ).to.be.revertedWith("nullifier used");
  });

  it("rifiuta il claim fuori dalla finestra temporale", async () => {
    const [backend, alice] = await ethers.getSigners();
    const ev = await (await ethers.getContractFactory("RunEvents", backend)).deploy(backend.address);
    const past = Math.floor(Date.now() / 1000) - 7200;
    await ev.connect(alice).createEvent("Old", past, past + 60, "");
    const nul = ethers.keccak256(ethers.toUtf8Bytes("late"));
    const digest = ethers.solidityPackedKeccak256(["uint256", "address", "bytes32"], [1n, alice.address, nul]);
    const sig = await backend.signMessage(ethers.getBytes(digest));
    await expect(ev.connect(alice).claim(1n, nul, sig)).to.be.revertedWith("claim window closed");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd contracts && npx hardhat test test/runEvents.test.ts`
Expected: FAIL — `HH700: Artifact for contract "RunEvents" not found`.

- [ ] **Step 3: Implement the contract**

`contracts/contracts/RunEvents.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice Eventi di corsa creabili da chiunque. Il claim richiede la co-firma del backend,
/// che la produce solo dopo aver verificato una proof World ID (cloud-verify): il contratto
/// non può verificare la proof on-chain perché su 0G non esiste un WorldIDRouter.
/// Garanzia offerta: una persona reale unica per evento. NON garantisce la partecipazione.
contract RunEvents {
    using ECDSA for bytes32;

    struct Event { address creator; string name; uint64 startsAt; uint64 endsAt; string uri; }

    address public immutable backend;
    uint256 public nextEventId = 1;

    mapping(uint256 => Event) public eventOf;
    mapping(uint256 => address[]) private _claimants;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;
    mapping(uint256 => mapping(bytes32 => bool)) public nullifierUsed;

    event EventCreated(uint256 indexed eventId, address indexed creator, string name);
    event Claimed(uint256 indexed eventId, address indexed claimant, bytes32 nullifierHash);

    constructor(address _backend) { backend = _backend; }

    function createEvent(string calldata name, uint64 startsAt, uint64 endsAt, string calldata uri)
        external returns (uint256 eventId)
    {
        require(endsAt > startsAt, "bad window");
        eventId = nextEventId++;
        eventOf[eventId] = Event(msg.sender, name, startsAt, endsAt, uri);
        emit EventCreated(eventId, msg.sender, name);
    }

    function claim(uint256 eventId, bytes32 nullifierHash, bytes calldata backendSig) external {
        Event memory e = eventOf[eventId];
        require(e.endsAt != 0, "unknown event");
        require(block.timestamp >= e.startsAt && block.timestamp <= e.endsAt, "claim window closed");
        require(!hasClaimed[eventId][msg.sender], "already claimed");
        require(!nullifierUsed[eventId][nullifierHash], "nullifier used");

        bytes32 digest = keccak256(abi.encodePacked(eventId, msg.sender, nullifierHash));
        require(
            MessageHashUtils.toEthSignedMessageHash(digest).recover(backendSig) == backend,
            "bad signature"
        );

        hasClaimed[eventId][msg.sender] = true;
        nullifierUsed[eventId][nullifierHash] = true;
        _claimants[eventId].push(msg.sender);
        emit Claimed(eventId, msg.sender, nullifierHash);
    }

    function claimantsOf(uint256 eventId) external view returns (address[] memory) {
        return _claimants[eventId];
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd contracts && npx hardhat test test/runEvents.test.ts`
Expected: PASS (4 test). Poi `npx hardhat test` per confermare che i 2 test preesistenti restano verdi.

- [ ] **Step 5: Deploy su Galileo e commit**

Aggiungere a `contracts/scripts/deploy.ts` il deploy di `RunEvents` (backend = treasury address, lo stesso che co-firma), poi:

```bash
cd contracts && set -a && . ../.env && set +a && npx hardhat run scripts/deploy.ts --network zgTestnet
```
Scrivere `RUN_EVENTS_ADDRESS=` nel `.env` locale **e** in `/srv/0run/.env` sul server. Verificare con `eth_getCode` che l'indirizzo abbia bytecode e annotare il link chainscan in `docs/decisions.md`.

```bash
git commit contracts/contracts/RunEvents.sol contracts/test/runEvents.test.ts contracts/scripts/deploy.ts docs/decisions.md -m "feat(contracts): RunEvents with World-gated co-signed claims"
```

---

### Task 2: World ID cloud-verify + API eventi + UI

**Files:**
- Create: `apps/web/src/lib/world/verify.ts`, `apps/web/src/app/api/world/rp-context/route.ts`, `apps/web/src/app/api/events/route.ts`, `apps/web/src/app/api/events/[id]/claim/route.ts`, `apps/web/src/app/events/page.tsx`, `apps/web/src/app/events/[id]/page.tsx`
- Modify: `apps/web/src/db/schema.ts` (tabelle `events`, `claims` — additive), `.env.example`
- Test: `apps/web/src/lib/world/verify.test.ts`, `apps/web/src/app/api/events/events.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `RunEvents` (Task 1), design system.
- Produces: `verifyWorldProof(payload, signal): Promise<{ok:true; nullifierHash:string; level:string} | {ok:false; error:string}>`; `POST /api/events` (crea, qualsiasi utente), `GET /api/events` (lista con conteggio claim), `POST /api/events/:id/claim` (verifica proof → co-firma → tx). Tabelle: `events(id, onchainId, creatorUserId, name, startsAt, endsAt, txHash)`, `claims(id, eventId, userId, nullifierHash, txHash)` con **UNIQUE(eventId, nullifierHash)**.

- [ ] **Step 1: Prerequisiti manuali (fuori dal codice)**

Registrare l'app su `developer.world.org`: ottenere `app_id`, `rp_id`, e la signing key per l'rp-context. Creare l'action (es. `claim-run-event`). Mettere in `.env` (e in `/srv/0run/.env`): `NEXT_PUBLIC_WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_SIGNING_KEY`, `NEXT_PUBLIC_WORLD_ACTION=claim-run-event`. Aggiungere le stesse chiavi (vuote) a `.env.example`. Installare: `npm i -w web @worldcoin/idkit`.

- [ ] **Step 2: Write the failing verify test**

`apps/web/src/lib/world/verify.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const proof = { merkle_root: "0xmr", nullifier_hash: "0xnul", proof: "0xp", verification_level: "orb" };

describe("verifyWorldProof", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("success===true → ok con nullifier", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) })));
    const { verifyWorldProof } = await import("./verify");
    const r = await verifyWorldProof(proof as never, "signal-1");
    expect(r).toEqual({ ok: true, nullifierHash: "0xnul", level: "orb" });
  });

  it("risposta SENZA campo success → ok:false (check strict, mai lasco)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
    vi.resetModules();
    const { verifyWorldProof } = await import("./verify");
    expect((await verifyWorldProof(proof as never, "s")).ok).toBe(false);
  });

  it("HTTP non-2xx → ok:false, nessun throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ code: "invalid_proof" }) })));
    vi.resetModules();
    const { verifyWorldProof } = await import("./verify");
    expect((await verifyWorldProof(proof as never, "s")).ok).toBe(false);
  });

  it("non logga mai la proof", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) })));
    vi.resetModules();
    const { verifyWorldProof } = await import("./verify");
    await verifyWorldProof(proof as never, "s");
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("0xp");
    spy.mockRestore();
  });
});
```

Run: `npm run test -w web -- src/lib/world` → FAIL (modulo assente).

- [ ] **Step 3: Implement verify.ts**

`apps/web/src/lib/world/verify.ts`:

```ts
import { hashSignal } from "@worldcoin/idkit/hashing";

export type WorldProof = {
  merkle_root: string; nullifier_hash: string; proof: string; verification_level: string;
};
type Result = { ok: true; nullifierHash: string; level: string } | { ok: false; error: string };

/** Cloud-verify: su 0G non esiste un WorldIDRouter, quindi la proof si verifica lato
 *  server contro l'API World e il backend co-firma il claim on-chain. Il check è
 *  strict (`success === true`): una risposta senza il campo NON è un successo. */
export async function verifyWorldProof(proof: WorldProof, signal: string): Promise<Result> {
  const rpId = process.env.WORLD_RP_ID;
  if (!rpId) return { ok: false, error: "WORLD_RP_ID non configurato" };
  try {
    const res = await fetch(`https://developer.world.org/api/v4/verify/${rpId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        protocol_version: "3.0",
        action: process.env.NEXT_PUBLIC_WORLD_ACTION,
        responses: [{
          identifier: proof.verification_level,
          merkle_root: proof.merkle_root,
          nullifier: proof.nullifier_hash,
          proof: proof.proof,
          signal_hash: hashSignal(signal).digest,
        }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `world verify HTTP ${res.status}` };
    if (body?.success !== true) return { ok: false, error: "proof non valida" };
    return { ok: true, nullifierHash: proof.nullifier_hash, level: proof.verification_level };
  } catch (e) {
    // Mai includere la proof nel messaggio d'errore.
    return { ok: false, error: `world verify failed: ${e instanceof Error ? e.message : "unknown"}` };
  }
}
```

Run: `npm run test -w web -- src/lib/world` → PASS (4).

- [ ] **Step 4: API eventi + claim, con test**

`apps/web/src/app/api/events/events.test.ts` deve coprire: creazione evento (200 + riga DB), claim con proof valida (co-firma + tx + riga claims), claim con proof invalida → 401 e **nessuna tx inviata**, secondo claim con lo stesso nullifier → 409 (constraint UNIQUE). Mockare `@/lib/world/verify`, `@/lib/zerog/contracts` e `@/db` seguendo lo stile di `apps/web/src/app/api/coach/mint/mint.test.ts`.

Il signal è `hash(eventId + wallet)`: calcolarlo lato server con la stessa formula del client e **rifiutare** se il client ne manda uno diverso (altrimenti una proof può essere riusata su un altro claim).

`POST /api/events/:id/claim` in ordine: `requireUser` → ricalcola il signal → `verifyWorldProof` → se ok, firma `keccak256(abi.encodePacked(eventId, wallet, nullifier))` con la treasury key → chiama `RunEvents.claim` → inserisce in `claims` (l'UNIQUE è la difesa finale anti-replay) → risponde con il tx hash.

- [ ] **Step 5: UI eventi**

`/events`: lista come feed editoriale (overline con data, nome in Playfair, conteggio partecipanti come micro-label, `<Card>`), form di creazione in linea. `/events/[id]`: dettaglio, widget IDKit per il claim, crew dei partecipanti con avatar in grayscale→colore, e **una riga di testo esplicita sul trust model** ("chiunque può creare un evento: il claim prova una persona reale unica, non la presenza"). Palette e tipografia del design system, nessun hex.

- [ ] **Step 6: Verify + commit**

`npm run test -w web` (nessuna regressione), `npx tsc --noEmit` clean, prova manuale del claim con World App reale.

```bash
git commit apps/web/src/lib/world apps/web/src/app/api/world apps/web/src/app/api/events apps/web/src/app/events apps/web/src/db/schema.ts .env.example -m "feat(web): World-gated event claims with sybil-resistant crew"
```

---

### Task 3: Identità ENS dell'agente (Sepolia)

**Files:**
- Create: `apps/web/src/lib/ens/resolve.ts`, `apps/web/src/lib/ens/subname.ts`, `apps/web/src/components/coach/ens-badge.tsx`
- Modify: `apps/web/src/app/api/coach/mint/route.ts` (assegnazione subname dopo il mint), `apps/web/src/app/dashboard/page.tsx` (mostrare il nome), `.env.example`
- Test: `apps/web/src/lib/ens/resolve.test.ts`

**Interfaces:**
- Produces: `resolveCoachEns(name: string): Promise<{address: string|null; records: Record<string,string>}>` (live su Sepolia, **niente valori hard-coded**: è un requisito esplicito del bando ENS); `assignSubname(label: string, owner: string, records: {tokenId: string; endpoint: string}): Promise<{name: string; txHash: string}>`.

- [ ] **Step 1: Prerequisito manuale — PRIMA dell'hackathon**

Registrare `0run.eth` su **Sepolia** (gratis con ETH di test) e verificare di poter creare subname via NameWrapper. Mettere in `.env`: `ENS_SEPOLIA_RPC`, `ENS_PARENT_NAME=0run.eth`, `ENS_OWNER_PRIVATE_KEY` (wallet separato con ETH Sepolia). Installare: `npm i -w web viem` (già presente) — usare `viem/ens`.

- [ ] **Step 2: Write the failing resolve test**

`apps/web/src/lib/ens/resolve.test.ts`: mockare il client viem e verificare che (a) un nome esistente restituisca address + i text record `agent-context` e `agent-endpoint[web]`; (b) un nome inesistente restituisca `{address: null, records: {}}` senza throw; (c) la funzione non contenga fallback hard-coded (test: con il client che rifiuta, il risultato è vuoto, non un valore finto).

Run: `npm run test -w web -- src/lib/ens` → FAIL.

- [ ] **Step 3: Implement resolve + subname**

`resolve.ts` usa `createPublicClient({chain: sepolia, transport: http(process.env.ENS_SEPOLIA_RPC)})` con `getEnsAddress` e `getEnsText` per le chiavi ENSIP-26 (`agent-context`, `agent-endpoint[web]`) più una chiave custom `0run:inft` con `chainId:contract:tokenId`. `subname.ts` crea il subname sotto `0run.eth` e scrive i text record con `setText` sul public resolver.

- [ ] **Step 4: Wire nel mint + UI**

Dopo un mint riuscito, assegnare `<slug-del-coach>.0run.eth` al wallet dell'utente e scrivere i record. **Non bloccare il mint** se ENS fallisce (rete diversa, può essere lenta): registrare l'esito e mostrare il nome quando c'è. `ens-badge.tsx` risolve **live** e mostra il nome con link a `app.ens.domains` (rete Sepolia dichiarata).

- [ ] **Step 5: Verify + commit**

Test verdi, `tsc` clean, e verifica manuale che la risoluzione avvenga davvero via RPC (spegnere il record e vedere il badge sparire — prova che non è hard-coded).

```bash
git commit apps/web/src/lib/ens apps/web/src/components/coach apps/web/src/app/api/coach/mint/route.ts .env.example -m "feat(web): live ENS identity for coach agents (ENSIP-26 records)"
```

---

### Task 4: Registrazione ERC-8004 (bonus quasi gratuito)

**Files:**
- Create: `apps/web/src/lib/erc8004/register.ts`
- Modify: `apps/web/src/app/api/coach/mint/route.ts`, `docs/decisions.md`
- Test: `apps/web/src/lib/erc8004/register.test.ts`

**Interfaces:**
- Produces: `registerAgent(tokenId: string, agentUri: string): Promise<{agentId: string; txHash: string} | {error: string}>` contro IdentityRegistry `0x8004A818BFB912233c491871b3d84c89A494BD9e` su Galileo (già deployato: nessun contratto nostro).

- [ ] **Step 1: Ispezionare l'ABI reale del registry**

Leggere l'implementazione di riferimento (`github.com/erc-8004/erc-8004-contracts`) o l'explorer `8004scan.io` per la firma esatta di registrazione. **Non indovinare l'ABI**: un ABI sbagliato fallisce solo a runtime on-chain. Annotare in `docs/decisions.md` la firma trovata e la fonte.

- [ ] **Step 2: Write the failing test**

Test con contratto mockato: registrazione riuscita → `{agentId, txHash}`; revert → `{error}` senza throw (il mint non deve fallire per questo).

- [ ] **Step 3: Implement + wire**

Chiamare `registerAgent` dopo il mint, **non bloccante** (come ENS). Salvare `agentId` sulla riga `coaches`.

- [ ] **Step 4: Verify on-chain e commit**

Eseguire una registrazione reale su Galileo, verificare su `8004scan.io`, annotare il link in `docs/decisions.md` (è materiale da submission: il bando parla di "Agentic ID").

```bash
git commit apps/web/src/lib/erc8004 apps/web/src/app/api/coach/mint/route.ts apps/web/src/db/schema.ts docs/decisions.md -m "feat(web): register coach agents on the ERC-8004 identity registry"
```

---

### Task 5: Badge coach autodichiarato (F1 della spec real-coach)

**Files:**
- Create: `apps/web/src/app/api/coach-claims/route.ts`, `apps/web/src/components/crew/coach-badge.tsx`
- Modify: `apps/web/src/db/schema.ts` (`coachClaims`), `apps/web/src/app/dashboard/page.tsx`
- Test: `apps/web/src/app/api/coach-claims/coach-claims.test.ts`

**Interfaces:**
- Produces: `POST /api/coach-claims` (richiede World ID verificato: riusa `verifyWorldProof` con action dedicata) → riga `coachClaims(userId, nullifierHash UNIQUE, claimedAt)`; `<CoachBadge selfDeclared />`.

- [ ] **Step 1: Write the failing test**

Verificare: claim senza proof valida → 401; con proof valida → 200 e riga creata; secondo claim dallo stesso nullifier → 409.

- [ ] **Step 2: Implement**

Il badge dice letteralmente **"coach · autodichiarato"** (micro-label uppercase `tracking-[0.3em]`, linea decorativa orange, `<Card featured>`), mai "verified". Un tooltip/riga spiega la scala di fiducia: persona reale unica verificata → autodichiarazione → reputazione guadagnata.

- [ ] **Step 3: Verify + commit**

```bash
git commit apps/web/src/app/api/coach-claims apps/web/src/components/crew apps/web/src/db/schema.ts -m "feat(web): self-declared coach badge gated by proof of personhood"
```

---

## Self-Review (eseguita)

1. **Copertura scope:** eventi permissionless ✓ (T1) · claim World ID sybil-resistant con signal binding ✓ (T2) · crew nel profilo ✓ (T2 UI) · identità ENS live ENSIP-26 ✓ (T3) · ERC-8004 ✓ (T4) · badge coach autodichiarato ✓ (T5). Letting del coach e review umana restano nel Piano C / post-hackathon come già dichiarato nelle spec.
2. **Placeholder:** nessun TBD. I Task 2-5 descrivono i test per intento e forma invece di riportarne il codice integrale come nel Piano A: accettato consapevolmente perché la loro forma è vincolata dai pattern già in repo (`mint.test.ts` per le route, `inference.test.ts` per i fetch mockati) e citata esplicitamente — ma l'implementer deve scriverli prima dell'implementazione, non dopo.
3. **Coerenza tipi/firme:** il digest co-firmato è `keccak256(abi.encodePacked(eventId, msg.sender, nullifierHash))` identico in Solidity (T1) e nel backend (T2) — un disallineamento qui fa fallire ogni claim on-chain con "bad signature", quindi va verificato con un test di integrazione contro il contratto deployato, non solo con i mock. `RUN_EVENTS_ADDRESS` è la sola fonte dell'indirizzo. Il signal `hash(eventId + wallet)` è calcolato con la stessa formula su client e server (T2 Step 4).
