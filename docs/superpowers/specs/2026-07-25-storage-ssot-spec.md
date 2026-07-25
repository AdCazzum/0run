# 0run — 0G Storage come source of truth per GPX e dati derivati

**Data:** 2026-07-25 · **Stato:** proposta · **Dipende da:** [design MVP](./2026-07-24-0run-mvp-design.md), [decisions.md](../../decisions.md)

## 1. Contesto e problema

Il design MVP dichiara "la fonte di verità resta 0G" e Postgres come "indice di navigazione". Oggi (stato reale del codice) questa affermazione è vera solo a metà:

| Dato | Su 0G Storage | On-chain | Solo in Postgres |
|---|---|---|---|
| GPX grezzo cifrato | ✓ (blob) | — | **rootHash** (`runs.gpx_root`) |
| Memoria coach (strato privato) | ✓ (blob) | `CoachRegistry.memoryRoot` (solo l'ultima) | copia dei root |
| Coaching profile | ✓ (blob) | `CoachRegistry.profileRoot` | copia dei root |
| Report completo del coach | — | — | ✓ (`runs.report`) |
| Stats corsa, polyline | — | — | ✓ (jsonb) |
| Chat history | — | — | ✓ |

Il punto debole è strutturale: **0G Storage non è enumerabile**. Non esiste "dammi tutti i blob del wallet X" — un blob esiste solo se ne conosci il rootHash. Il rootHash dei GPX vive esclusivamente in `runs.gpx_root`; la `CoachMemory` (schema in `packages/shared/src/types.ts`) contiene `RunSummary` con stats e headline, ma **non i rootHash dei GPX né i report completi**.

**Se il DB muore oggi:** i blob GPX diventano orfani per sempre (cifrati, esistenti, irraggiungibili); i report completi spariscono; sopravvive solo l'ultima memoria (via `CoachRegistry.memoryOf(tokenId)` → download → decrypt con chiave utente), cioè stats aggregate e headline. "Fonte di verità" oggi significa: *i byte sono su 0G, ma la mappa per trovarli è nel DB*. La mappa È il dato.

## 2. Obiettivo

Definizione operativa di source of truth: **dato solo `wallet + firma utente` (per derivare la chiave AES via HKDF) e la chain, il DB deve essere interamente ricostruibile** per quell'utente — corse, root dei GPX, report, stato del coach. Postgres degrada a cache invalidabile; la demo può dirlo ai giudici senza asterischi ("possiamo droppare il DB e ricostruirlo da chain + storage").

## 3. Design: la memoria È il manifest

Due opzioni valutate:

**A — Manifest separato**: nuovo documento JSON cifrato per-utente (indice di rootHash), caricato a ogni upload, ancorato con un campo/evento dedicato (nuovo campo in `CoachRegistry` o contratto a parte).
**B — Memoria come manifest** *(scelta)*: estendere `RunSummary` dentro `CoachMemory` con i campi che oggi vivono solo nel DB. La memoria è **già** ri-cifrata e ri-caricata a ogni corsa, e il suo root è **già** ancorato on-chain da `CoachRegistry.update()`. Il manifest esiste già — gli mancano solo i campi.

| | A (separato) | B (memoria = manifest) |
|---|---|---|
| Upload extra per corsa | +1 blob | 0 |
| Modifiche contratto | sì (campo/evento) | **zero** |
| Tx extra per corsa | 0-1 | 0 |
| Ore stimate | ~8-10 | ~5-7 |
| Rischio | nuovo pezzo da testare | schema esistente cresce |

Contro di B: la memoria entra nei prompt di inferenza — ma i prompt builder (`lib/coach/prompts.ts`) selezionano già i campi, quindi `gpxRoot`/`report` non inquinano il contesto. La memoria cresce di ~1-2 KB/corsa: irrilevante per l'MVP (decine di corse), da rivedere post-hackathon (compaction, split manifest/memoria). B vince: **zero contratti nuovi, zero upload extra, zero tx extra** — e T13/T14 (mint flow, pipeline upload) non sono ancora implementati, quindi il costo di integrazione è quasi nullo se si decide ora.

### Estensione schema (`RunSummarySchema`)

```
gpxRoot: string          // rootHash del GPX cifrato su 0G Storage
gpxContentHash: string   // keccak256 del GPX in chiaro (dedup applicativo, §6)
report: { headline, analysis, comparison, advice[] }  // il report completo
```

`CoachMemorySchema` resta `version: 1` — nulla è deployato, nessuna migrazione necessaria (§7 per il versioning futuro). Il coaching profile **non cambia**: niente rootHash nel profile — è cifrato con chiave di servizio e il renter del letting non deve poter localizzare i blob privati del proprietario. Il confine di privacy resta il confine delle chiavi.

## 4. Ancoraggio on-chain e versioning: già sufficiente

Nessun contratto nuovo. La catena di ancoraggio esistente copre tutto:

```
wallet → OrunAgentNFT.Minted(tokenId, to) [event, indexed]
       → CoachRegistry.memoryOf(tokenId) → { memoryRoot, profileRoot, runCount, updatedAt }
       → download(memoryRoot) + decrypt(chiave utente) → manifest completo
```

Bonus già gratis: **ogni versione storica è recuperabile**. `MemoryUpdated` viene emesso a ogni corsa con i root del momento; i blob su 0G Storage sono immutabili e restano lì. Chain = storia di tutti i puntatori, Storage = storia di tutti i blob, `runCount` = numero di versione monotono. Time-travel dello stato del coach leggendo i log — argomento forte in pitch, costo zero.

Nota tecnica: il rootHash 0G è un Merkle root da 32 byte (`0x` + 64 hex) → entra esatto nei `bytes32` di `CoachRegistry`, nessuna conversione lossy.

## 5. Re-sync: il DB si ricostruisce

`POST /api/me/resync` (autenticato Privy; il client passa la firma da cui derivare la chiave, come per ogni operazione — mai persistita):

1. `wallet` → query log `Minted(*, wallet)` su Galileo → `tokenId` (RPC di riserva in config, come da design MVP).
2. `CoachRegistry.memoryOf(tokenId)` → `memoryRoot`, `profileRoot`.
3. `downloadDecrypted(memoryRoot, chiaveUtente, validate=CoachMemorySchema)` — la validazione zod è il guard contro chiave sbagliata (il download con chiave errata restituisce garbage **senza errore**, già gestito in `lib/zerog/storage.ts`).
4. Upsert idempotente: `coaches` (nome, personalità, root, tokenId) + una riga `runs` per ogni `RunSummary` (stats, `gpxRoot`, report, `status: done`). Chiave di idempotenza: `(userId, gpxContentHash)`.
5. `polyline`: **non** nel manifest (pesante, ridondante — è derivabile dal GPX). Ricostruita lazy: alla prima vista della corsa, se `polyline IS NULL`, il backend scarica il GPX da `gpxRoot`, ri-parsa, salva. Il re-sync resta veloce (1 download piccolo), il costo dei download grossi si paga solo per le corse effettivamente riaperte.

Conseguenza onesta del modello di cifratura: **il recovery è per-utente e lazy, non bulk**. Il server non può ricostruire righe di utenti che non si ri-loggano (non ha le loro chiavi) — by design, ed è la cosa giusta: l'operatore non può leggere i dati, quindi non può nemmeno ricostruirli da solo. Il backup Postgres resta best practice operativa; il re-sync è la garanzia di sovranità, non lo strumento di ops quotidiano. In demo: "kill del DB live → login → re-sync → tutto torna" è un momento forte ma rischioso (indexer flaky) — da provare nel runbook e decidere se mostrarlo o solo raccontarlo (open question).

## 6. Dedup e cifratura nonce-random

Il dedup nativo di 0G ("stesso file → stesso rootHash", bug SDK #49 citato nel design MVP) **non si applica mai ai nostri blob**: il wrapper aes256 dell'SDK antepone un nonce random di 16 byte per ogni cifratura (documentato in `lib/zerog/storage.ts`), quindi lo stesso GPX caricato due volte produce ciphertext — e rootHash — sempre diversi. Implicazioni:

- **Niente dedup a livello storage.** Ogni upload è un blob nuovo, anche se il contenuto è identico. Costo accettato (testnet, blob piccoli).
- **È una feature di privacy, non solo un costo**: rootHash uguali tra utenti diversi rivelerebbero "questi due hanno lo stesso file" (confirmation attack: due runner della stessa corsa di gruppo caricherebbero GPX quasi identici). Con nonce random un osservatore della chain/storage non correla nulla. Da dire in pitch.
- **Il dedup si fa a livello applicativo**: `gpxContentHash = keccak256(gpx in chiaro)` nel manifest. All'upload, se il hash è già presente nella memoria → "corsa già caricata", niente doppio blob, niente doppia riga. Copre anche l'idempotenza del re-sync (§5.4).
- Il branch `already-finalized` in `storage.ts` resta corretto: scatta solo sul retry dello **stesso oggetto cifrato** (stesso nonce) dentro una singola `uploadEncrypted`, che è l'unico caso in cui deve scattare.

## 7. Costi, latenza, versioning

- **Per corsa, invariato rispetto a oggi**: 3 upload (GPX, memoria, profile) + 1 tx `CoachRegistry.update`. La scelta B non aggiunge né blob né tx. La pipeline attende già la finality con polling prima di dichiarare il blob disponibile (receipt pattern, indexer turbo con retry).
- **Re-sync**: 1 lettura log + 1 view call + 1 download piccolo → secondi, anche con indexer lento. I download GPX sono lazy (§5.5).
- **Versioning schema**: `version` è già un `literal` zod. Quando servirà `version: 2`, il pattern è union discriminata + funzione `upgrade(v1) → v2` applicata alla lettura (il blob v1 su Storage è immutabile: si migra in memoria, si riscrive alla prossima corsa). Non serve nulla ora — annotato perché il manifest è l'unico posto dove uno schema change rompe il recovery.

## 8. Cosa resta legittimamente solo nel DB

- **Chat history** — effimera by design (la chat legge la memoria, non la scrive; è nel design MVP). Perderla col DB è accettato e coerente: non è "dato dell'agente".
- **Stati pipeline** (`runs.steps`, righe `processing`/`error`) — transienti; una corsa mai completata non appartiene alla verità.
- **`users.funded_count`** — anti-abuse del funder, dato del server non dell'utente. Rischio accettato: DB perso → cap resettato → un utente potrebbe ri-drenare 3 top-up. Mitigazione a costo zero già possibile: il funder salta il top-up se il wallet ha già saldo sopra soglia.
- **Mapping `privy_did → wallet`** — si ri-materializza da solo al login successivo (upsert esistente).
- **Eventi & claim** (quando arriveranno, T post-core): verità già on-chain in `RunEvents` (eventi + nullifier), il DB è indice ricostruibile dai log — stesso pattern, nessun lavoro extra qui.

## 9. Piano MVP e stima ore

Prerequisito: decidere **prima** di implementare T13/T14 — così i campi nascono nel posto giusto invece di essere retrofittati.

| # | Attività | Ore |
|---|---|---|
| 1 | Estendere `RunSummarySchema` (+`gpxRoot`, `gpxContentHash`, `report`) + test | 1 |
| 2 | Wiring in pipeline T14: popolamento campi in `appendRun`, dedup su `gpxContentHash` | 1 |
| 3 | Lookup `tokenId` da log `Minted` (helper `lib/zerog/registry.ts`) | 1 |
| 4 | `POST /api/me/resync`: flusso §5, upsert idempotente | 2 |
| 5 | Polyline lazy su pagina run (`if NULL → download+parse+save`) | 1 |
| 6 | Test: resync su DB vuoto con memoria seedata; chiave sbagliata → errore pulito | 1-1.5 |

**Totale: ~6-7h.** Punti 1-2 sono il cuore (2h): da soli rendono il DB *teoricamente* ricostruibile e vanno fatti comunque dentro T14. I punti 3-6 rendono la ricostruzione *dimostrabile* e possono slittare dopo il ciclo core se il tempo stringe.

## 10. Cut-line — cosa NON facciamo

- **Manifest separato dalla memoria** (opzione A) — rivalutare post-hackathon se la memoria cresce troppo per i prompt.
- **Nessun contratto nuovo, nessun campo nuovo** in `CoachRegistry` — l'ancoraggio esistente basta.
- **Bulk restore amministrativo** — impossibile by design (il server non ha le chiavi utente); il backup Postgres resta la risposta ops.
- **Chat su Storage** — effimera, fuori dalla verità dell'agente.
- **Polyline nel manifest** — derivata, ricostruita lazy dal GPX.
- **Garbage collection dei blob storici** — su 0G i blob sono immutabili; le versioni vecchie restano (ed è un pregio, §4).
- **Key escrow / recovery cross-device della chiave** — la chiave deriva dalla firma del wallet Privy: finché l'utente ha il login, ha la chiave. Perdita account Privy = perdita dati: limite dichiarato, non lo risolviamo in hackathon.
- **Dedup storage-level o convergent encryption** — il nonce random resta: la non-correlabilità vale più del risparmio di spazio.
