# 0run — Design MVP per ETHGlobal Lisbon 2026

**Data:** 2026-07-24 · **Stato:** approvato a sezioni in brainstorming, in revisione finale

## 1. Obiettivo e contesto

**0run** è una web app dove un runner carica file GPX delle proprie corse e un **coach AI che possiede davvero** — un iNFT ERC-7857 ("Agentic ID") su 0G Chain — li analizza e lo allena. La memoria del coach è cifrata su 0G Storage e cresce a ogni corsa; l'inferenza gira su 0G Compute con attestazione TEE; il grafo sociale nasce da eventi di corsa reali attestati on-chain, non da sorveglianza GPS.

- **Obiettivo primario:** vincere il track 0G "Best AI Product" ($6.000) a ETHGlobal Lisbon 2026.
- **Side prize:** ENS "Best ENS Integration for AI Agents" ($1.500, booth domenica mattina) e World "AgentKit New Use Cases" ($8.000).
- **Team:** 3-4 persone, coperte tutte le competenze (Solidity, React/Next, Node TS, AI/prompting).
- **Priorità di taglio quando manca il tempo:** ciclo core 0G > eventi/World > ENS > letting > polish. Il letting si taglia per primo; il ciclo core mai.

Deliverable del bando 0G (testuali): proof di inferenza su 0G Compute, link al mint dell'Agentic ID su explorer, video < 3 min, repo pubblico con README/setup, live demo link, contract addresses, contatti Telegram/X.

## 2. Funzionalità MVP

Sette funzionalità, un solo percorso demo che tocca ogni deliverable:

1. **Login senza frizione** — email via Privy, embedded wallet auto-creato su 0G Galileo (`defineChain`, chainId 16602). Un funder backend accredita gas al primo accesso (niente gas sponsorship 4337: non esiste infra su 0G). Zero seed phrase.
2. **Mint del coach (una tantum)** — l'utente sceglie nome e **personalità di base** del coach: **Pacer** (ti accompagna, rinforzo positivo), **Coach** (equilibrato, dati alla mano), **Drill Sergeant** (nessuno sconto). La personalità viene scritta nella memoria iniziale e modifica il system prompt di ogni inferenza. Il backend cifra la memoria iniziale, la carica su 0G Storage, minta l'AgentNFT con il `dataHash` e mostra il link al mint su chainscan-galileo. In demo: stesso GPX su due personalità diverse → due report con toni opposti = la memoria determina il comportamento dell'agente.
3. **Upload corsa** — GPX → parse server-side (distanza, passo, splits, dislivello, FC) → GPX cifrato su Storage → memoria aggiornata, ri-cifrata, ri-caricata → nuovo hash su `CoachRegistry` → inferenza 0G Compute. La UI mostra la **pipeline a stati** ("Cifratura ✓ → Upload 0G ✓ → Memoria aggiornata (tx) ✓ → Il coach analizza…"): ogni spunta è un servizio 0G colpito live, l'architettura si racconta da sola in demo.
4. **Report + chat** — mappa del percorso (Leaflet), card statistiche, commento del coach che **cita esplicitamente le corse precedenti**, badge "TEE verified" cliccabile. Sotto, chat conversazionale col coach (legge la memoria, non la scrive — scrittura da chat = stretch goal).
5. **Eventi & crew** — chiunque crea eventi (nome, finestra temporale); chiunque si unisce; il **claim è gated da World ID** (una persona reale = un claim per evento, via nullifier). La crew (chi ha corso con te) appare sul profilo. Trust model dichiarato: sybil-resistant sì, verità di partecipazione no — conferma organizzatore in roadmap. Primo evento reale: EthLisbon Morning Run.
6. **Profilo** — lista corse, statistiche aggregate, card del coach con nome ENS risolto live (`<coach>.0run.eth`) e link a iNFT explorer + registrazione ERC-8004; sezione crew.
7. **Letting del coach** — un terzo paga per far valutare una propria corsa dal coach di qualcun altro. Nessun passaggio di chiavi (è concessione d'uso, non transfer): il renter non vede mai la memoria del proprietario; l'inferenza noleggiata carica **solo il coaching profile**, mai lo strato privato; la corsa del renter resta nello spazio del renter. La memoria del proprietario non viene modificata. Ultima feature in ordine di build.

**Fuori dall'MVP:** transfer dell'iNFT (l'oracle TEE pubblico per la ri-cifratura non esiste — in pitch come roadmap, con `authorizeUsage`/letting come alternativa ingegneristica consapevole), KV store 0G (nodo pubblico giù, verificato 24/07/2026), tracking real-time, correlazione GPS tra utenti, piani di allenamento, marketplace coach, scrittura memoria da chat.

**Nota demo:** l'account demo va seedato con 3-4 corse precedenti, altrimenti il "cita lo storico" non ha storico da citare.

## 3. Architettura

### Struttura repo (monorepo)

```
apps/web        → Next.js App Router: frontend + API routes (unico deployable web)
contracts/      → Hardhat: AgentNFT+Verifier (da 0gfoundation/0g-agent-nft) + CoachRegistry, RunEvents, (CoachRental)
packages/shared → tipi TS condivisi (stats corsa, schema memoria, receipt)
docker-compose.yml → postgres + web (+ funder come job)
```

### Reti e servizi

| Cosa | Dove | Perché |
|---|---|---|
| Contratti, mint iNFT, attestazioni | 0G Galileo testnet (16602, `evmrpc-testnet.0g.ai`) | explorer chainscan-galileo per i deliverable |
| File e memoria cifrati | 0G Storage testnet (indexer turbo) | cifratura aes256 integrata nell'SDK |
| Inferenza — path A | Router mainnet `router-api.0g.ai/v1` | modelli TeeML di qualità (glm-5.2, 0gm-1.0-35b-a3b), setup 15 min |
| Inferenza — path B | Direct SDK su testnet (broker) | `processResponse()` = verifica TEE per-risposta dimostrabile |
| ENS | Sepolia | ENS non vive su 0G; subname di `0run.eth` + ENSIP-26 |
| World ID | cloud-verify v4 (`developer.world.org`) | verify on-chain impossibile su 0G |
| DB (indice UI) | Postgres in Docker | fonte di verità resta 0G; preferenza self-hosted |
| Deploy | VPS Hetzner, docker-compose | live demo link del bando; niente Vercel/Neon |

Ai giudici si dichiara così com'è: "contratti su testnet, inferenza sul router di produzione perché è dove sta il TEE attestato".

### Inferenza: un'interfaccia, due backend

Il parametro `verify_tee` del Router **non è garantito dai docs** (la garanzia documentata via Router è solo "provider TEE-acknowledged"). La verifica per-risposta documentata è nel flusso Direct: `getRequestHeaders → fetch ${endpoint}/chat/completions → header ZG-Res-Key → broker.inference.processResponse()` → flag `verified`. Design: modulo `lib/inference/` con interfaccia unica e due adapter (Router / Direct), pattern a 3 file di schwarma-orchestrator (config / broker singleton / wrapper per-richiesta). Il primario si decide allo **spike del giorno 0**; il badge "TEE verified" in demo viene comunque dal path Direct (codice funzionante da copiare da cannes2026, incluso failover multi-provider). Fondi Direct (~3-5 OG di ledger, il faucet dà 0.1/giorno): chiederli allo stand 0G venerdì (workshop ore 14:30). Modelli letti da `GET /v1/models` a runtime — gli id nei docs sono sbagliati. Mai usare i modelli claude-*/gpt-* del Router: proxati senza attestazione TEE.

### Cifratura e chiavi

- **Chiave utente**: derivata da firma wallet su messaggio fisso al login (firma → HKDF → AES-256). Mai persistita: il client la passa al backend per singola operazione, uso solo in memoria.
- **Memoria a due strati, due chiavi**: *strato privato* (corse grezze, storico personale) cifrato con la chiave utente; *coaching profile* (personalità, metodologia, soglie, aggregati non-personali) cifrato con chiave di servizio — necessario perché al momento del noleggio il proprietario è offline. **Il confine di privacy coincide col confine delle chiavi.**
- Upload cifrati con l'opzione nativa dell'SDK (`{ encryption: { type: 'aes256', key } }`); download con `indexer.downloadToBlob` (mai `download()`: non funziona in browser e comunque si opera da backend). ECIES tenuto come pattern per il transfer futuro.
- Limite dichiarato: durante l'elaborazione il backend vede il plaintext (il GPX va parsato). Roadmap: backend dentro 0G Private Computer.

### Data flow

**Upload corsa:** client (GPX + chiave derivata) → API → parse → stats → upload GPX cifrato (→ `rootHash_gpx`) → aggiorna memoria (append strato privato, ricalcolo aggregati profile) → ri-cifra → ri-upload (→ `rootHash_mem`) → tx `CoachRegistry.update(tokenId, memoryRoot, profileRoot)` → inferenza (system: personalità + profile; user: stats corrente + sommari ultime N corse) → report + flag verified → DB → client (report, stats, polyline, 3 link di proof: storagescan, chainscan, verifica TEE). Pipeline asincrona con stato per step (SSE o polling con cursore, pattern JSONL di cannes2026); GPX grosso → pre-aggregare le stats, mai il GPX grezzo nel prompt (ctx 32k sul fallback testnet).

**Chat:** client → API → decifra strato privato → completion col contesto conversazione (persistita in DB) → risposta. Nessuna scrittura in memoria.

**Letting:** renter carica corsa su coach altrui → verifica noleggio attivo on-chain → stessa pipeline ma memoria = **solo coaching profile del proprietario**; corsa e report nello spazio del renter, cifrati con la chiave del renter; la memoria del proprietario non si tocca.

### Schema DB (indice di navigazione)

`users` (privy_did, wallet, coach_token_id, ens_name) · `coaches` (token_id, personalità, memory_root, profile_root) · `runs` (user, stats jsonb, gpx_root, report, tx refs) · `events` (creator, nome, finestra, contract_event_id) · `claims` (event, user, nullifier UNIQUE per evento, tx) · `rentals` (token_id, renter, until, tx) · `chat_messages`. Migration all'avvio (niente `ensureSchema` per-request).

## 4. Contratti (Galileo 16602)

1. **AgentNFT + Verifier** — dal repo `0gfoundation/0g-agent-nft`. Ambiguità di branch (`main` vs `eip-7857-draft`, firme diverse; i docs citano il draft): **la scelta si fa allo spike ispezionando il codice**, non dai docs. Convenzione metadata: `dataDescription = "0g://storage/<rootHash>"`, `dataHash = keccak256(ciphertext)`. Fallback pronto: `ZeroGClaw.sol` da cannes2026 (ERC-7857 minimale già girato su Galileo). Nessun oracle serve per il mint.
2. **CoachRegistry** (~40 righe) — `tokenId → {memoryRoot, profileRoot, runCount, updatedAt}`, evento `MemoryUpdated`: la tx mostrata a ogni corsa.
3. **RunEvents** (~80 righe) — `createEvent(name, startsAt, endsAt, uri)` aperto a tutti; `claim(eventId, nullifierHash, backendSig)`: il backend co-firma solo dopo cloud-verify World riuscito; ECDSA check + nullifier mai riusato per evento (e UNIQUE in Postgres). **Signal binding**: signal World ID = `hash(eventId + wallet)` — proof legata a quel claim.
4. **Letting** — prima scelta: estensione **Authorize** di ERC-7857 (`authorizeUsage(tokenId, executor, permissions)`, max 100 utenti/token) se presente nel branch scelto: noleggio = authorizeUsage on-chain standard, più spec-compliant. Piano B: `CoachRental` custom (~60 righe: `pricePerRun` fissato dall'owner, pagamento diretto all'owner, un noleggio = una valutazione).
5. **Bonus (1-2h): registrazione ERC-8004** — IdentityRegistry (`0x8004A818BFB912233c491871b3d84c89A494BD9e`) e ReputationRegistry (`0x8004B663056A597Dffe9eCcC1965A193B7388713`) sono **già deployati** su Galileo. Il bando dice "Agentic ID" e i docs dichiarano compatibilità ERC-8004: registrare il coach (visibile su 8004scan.io) blinda il deliverable a costo quasi zero.

## 5. Integrazioni side prize

**ENS (Sepolia):** registrare `0run.eth` su Sepolia **prima** dell'hackathon; al mint di ogni coach → subname `<coach>.0run.eth` via NameWrapper + text record ENSIP-26: `agent-context`, `agent-endpoint[web]`, record custom → chainId 16602 + address AgentNFT + tokenId. Risoluzione live in UI (viem su RPC Sepolia) — il bando ENS vieta valori hard-coded. Presenza fisica al booth domenica mattina: assegnare una persona.

**World:** due agganci. (a) **AgentKit/AgentBook** (`@worldcoin/agentkit`, contratto AgentBook su World Chain mainnet): al mint, il coach viene collegato al suo umano verificato via `lookupHuman(address) → humanId` — "questo agente è human-backed". (b) **IDKit v4 cloud-verify** per il claim eventi: backend firma rp-context → widget IDKit → proof → `POST /api/v4/verify/{rp_id}` → co-firma claim. Codice da copiare da cannes2026/provenance-miniapp **con i loro bug corretti**: check `success === true` strict, nessuna backdoor di bypass, niente log delle proof, anti-replay in Postgres (non su file). Serve World App con identità verificata sul telefono di chi demo-a: testare il flusso completo prima di domenica. Al booth World: confermare che IDKit+AgentBook qualifichi come "uso significativo di AgentKit".

## 6. Error handling e demo-risk

- **Failover inferenza**: multi-provider sul Direct (pattern cannes2026), fallback modello sul Router (glm-5.2 → 0gm-1.0-35b-a3b → router testnet qwen2.5-omni). Niente failover automatico lato 0G: lo gestisce il backend.
- **Receipt pattern** (da provenance-miniapp): ogni operazione 0G ritorna una receipt (`published: false` + errore catturato) invece di lanciare — la demo non muore a metà. **Mai fallback su dati finti**: se 0G è giù si mostrano corse già elaborate (i mock squalificano su più track).
- **Storage**: retry su indexer turbo (lo standard era in 503); chiave sbagliata su `downloadToBlob` restituisce ciphertext **senza errore** → validare sempre che GPX/JSON parsino; dedup stesso file → stesso rootHash (bug SDK #49) → gestire "già esistente"; attendere finality con polling prima di dichiarare il file disponibile.
- **RPC**: `evmrpc-testnet.0g.ai` è "development only" → endpoint di riserva (Ankr/dRPC/QuickNode per Galileo) pronto in config.
- **Dipendenze**: `.npmrc` con `legacy-peer-deps=true` dal giorno zero (conflitti noti SDK 0G/World), Node 22, solo package `@0gfoundation/*` (gli `@0glabs/*` sono deprecati), ethers v6. ChainId solo 16602, centralizzato in config (16600/16601 nei tutorial sono obsoleti).
- **Fondi**: multipli wallet sul faucet dai giorni prima; tesoreria team; funder backend per gli embedded wallet; deposito router su pc.0g.ai in anticipo; fondi Direct chiesti allo stand 0G venerdì.
- **JSON dai modelli**: i modelli su 0G sbagliano spesso il JSON → prompt "ONLY valid JSON", estrazione robusta + retry con correzione (pattern schwarma), validazione zod. Kill-switch per i tools (il proxy 0G a volte si blocca sulle chat completions con function calling).

## 7. Testing

- **Spike giorno 0 (pre-hackathon, de-riska il 50%):** mint di prova su Galileo (scelta branch AgentNFT), upload+download cifrato di un GPX vero, una chiamata inferenza per entrambi i path con verifica `processResponse`, login Privy su chain custom. Solo dopo si scrive UI.
- **E2E:** `test-full-flow.sh` (pattern cannes2026): login → mint → upload → report → claim evento → letting, via curl+node.
- **World senza proof reali:** mock server dell'endpoint verify v4 (pattern provenance-miniapp `test-programmatic.mjs`) per testare il claim flow in CI/dev.
- **Unit:** parser GPX (file reali + edge case: GPX senza HR, tracce corrotte, dedup).
- **Runbook demo:** sequenza demo provata end-to-end su Hetzner con l'account seedato, prima di domenica.

## 8. Deliverable submission e ordine di build

**Compliance (~6-10h, da non scoprire domenica):** video < 3 min · live demo su Hetzner · README con mermaid dell'architettura e setup · `usages/0g.md`, `usages/world.md`, `usages/ens.md` che mappano ogni integrazione sponsor alla riga di codice esatta (pattern cannes2026) · contract addresses · link mint su chainscan + registrazione ERC-8004 · tx/flag di inferenza verificata · `test-full-flow.sh` · contatti Telegram/X.

**Ordine di build:** spike → ciclo core (login, mint, upload, report) → chat → eventi+World → ENS → ERC-8004 → letting → polish+video. Cut-line dal fondo, il ciclo core non si taglia mai.

## 9. Riferimenti

- Bando: https://ethglobal.com/events/lisbon2026/prizes (0G / World / ENS — The Graph escluso: chain 0G non supportata, verificato su networks-registry)
- Docs: https://docs.0g.ai/ai-context (cheat-sheet con network config, indirizzi, snippet) · docs storage/sdk · compute-network/inference e router/* · inft/* e agentic-id/*
- Repo pattern: `0gfoundation/0g-agent-nft` (contratti iNFT) · `0gfoundation/0g-storage-ts-starter-kit` (upload/download cifrato, browser) · `derek2403/cannes2026` (template 0G+World: broker singleton, inferenza+processResponse con failover, World v4, ZeroGClaw.sol, formato usages/*) · `chevoisiatesalvati/schwarma-orchestrator` (livello LLM a 3 file, SSE progress, JSON robusto, setup wallet Compute) · `saugardev/provenance-miniapp` (signal binding, anti-replay nullifier, receipt pattern, mock verify server)
- Endpoint: RPC `https://evmrpc-testnet.0g.ai` (16602) · indexer `https://indexer-storage-testnet-turbo.0g.ai` · router `https://router-api.0g.ai/v1` (testnet: `https://router-api-testnet.integratenetwork.work/v1`) · faucet `https://faucet.0g.ai` · explorer `https://chainscan-galileo.0g.ai`, `https://storagescan-galileo.0g.ai`
- SDK: `@0gfoundation/0g-storage-ts-sdk` (≥1.2.10) · `@0gfoundation/0g-compute-ts-sdk` (≥0.9.0) · `@privy-io/react-auth` · `@worldcoin/idkit` + `@worldcoin/agentkit` · viem/ethers v6
