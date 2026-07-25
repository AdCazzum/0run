# 0run — Real coach: verifica e integrazione di coach umani veri

**Data:** 2026-07-25 · **Stato:** proposta · **Dipende da:** [design MVP](./2026-07-24-0run-mvp-design.md), [design system](./2026-07-24-0run-design-system.md), decisioni contratti in `docs/decisions.md`

## 1. Obiettivo e contesto

Oggi in 0run "coach" significa solo l'agente AI. Questa spec introduce il **coach umano**: una persona reale che (a) è verificabile come tale, (b) supervisiona e annota i report AI, (c) possiede un proprio iNFT coach "allenato" sulla sua metodologia e noleggiabile tramite il letting già in design. Valore per i track: World ("human-backed agents" nel senso più letterale possibile) e 0G/ERC-8004 (reputazione dell'agente guadagnata on-chain, sul registry già deployato su Galileo).

**Premessa onesta che governa tutto lo scope:** questa feature è quasi certamente POST-hackathon, salvo il claim base + badge. La spec esiste per (1) far entrare la parte a costo marginale quasi nullo, (2) rendere il resto una slide di roadmap credibile perché progettata, non improvvisata.

## 2. Il problema di verifica — analisi adversariale

"Come provo che qualcuno è un vero coach?" è due domande diverse: *sei un umano unico?* e *sai allenare?* Nessuna singola opzione risponde a entrambe. Le passiamo al setaccio come farebbe un attaccante.

### (a) World ID — umano unico, non coach

Prova esattamente una cosa: dietro questo wallet c'è **una** persona reale, non una server farm. Attacco banale: chiunque, verificato, si dichiara coach — costo dell'attacco zero, World ID non dice nulla sulla competenza. Però uccide due attacchi che contano: le **coach farm sybil** (un umano = una identità coach, via nullifier) e la **deresponsabilizzazione** (il claim è ancorato a una persona che non può ricrearsi identità pulite dopo una brutta reputazione). Costo di integrazione ~zero: il flusso cloud-verify v4 esiste già per il claim eventi. **Verdetto: necessario, non sufficiente. Fondamenta, non verifica.**

### (b) Credenziali federali — la verifica che non si firma da sola

FIDAL, UESCA, RRCA, World Athletics CECS: nessuna espone un'API di verifica; "verificare" significa un umano che guarda un PDF. Domanda fatale: **chi firma l'attestazione on-chain?** Se firmiamo noi (team/organizzatore), il trust model collassa in "fidati del team 0run" — un oracle centralizzato travestito da verifica, e i giudici lo vedono al primo sguardo. I PDF si falsificano in cinque minuti; le federazioni sono eterogenee per paese (nessun registro globale); l'upload di documenti apre un fronte privacy che non vogliamo in un weekend. Attestazioni zk sulle credenziali non esistono per questi enti. **Verdetto: roadmap, tramite partnership di attestazione con le federazioni (loro firmano, non noi). Mai verifica manuale nostra spacciata per verifica.**

### (c) Reputazione on-chain guadagnata — ERC-8004

Il ReputationRegistry è **già deployato su Galileo** (`0x8004B663056A597Dffe9eCcC1965A193B7388713`), accanto all'IdentityRegistry (`0x8004A818BFB912233c491871b3d84c89A494BD9e`) dove il coach viene comunque registrato (bonus già in design MVP). Flusso: dopo un noleggio, il runner lascia una review sull'agente coach — pre-autorizzazione on-chain sul registry, payload della review su 0G Storage in chiaro (le review sono pubbliche), indice in Postgres. Misura la cosa giusta: *il coaching ha aiutato runner veri?* — proof-of-coaching, non proof-of-certificato.

Attacchi e mitigazioni:
- **Review sybil** → reviewer gated da World ID (una persona = una review per noleggio) **e** review possibile solo dopo noleggio pagato: il costo per review finta è almeno `pricePerRun` + un umano World-verified distinto.
- **Wash trading** (il coach noleggia se stesso via prestanome): il pagamento torna al coach, quindi il costo economico è ~solo gas — la vera barriera è il reclutamento di umani verificati distinti. Mitigazione ulteriore (roadmap): peso della review proporzionale allo storico corse/claim eventi del reviewer.
- **Cold start**: un coach nuovo ha reputazione zero → lo copre l'etichetta onesta "autodichiarato" (§3), non un numero gonfiato.

**Verdetto: il meccanismo giusto per 0run — e con il registry già in chain, il più economico da raccontare. MVP se il letting entra; comunque in pitch.**

### (d) Endorsement a catena — web of trust

Coach verificati garantiscono altri coach. Problema di bootstrap circolare: i primi coach verificati li verifica… chi? (Torna la domanda (b).) Gli anelli di collusione si deterrono solo con stake+slashing — meccanica troppo pesante per l'MVP e per la demo. **Verdetto: moltiplicatore utile in roadmap, solo dopo che (b) o (c) hanno creato radici di fiducia; mai da solo.**

### Sintesi: fiducia stratificata, dichiarata onestamente

Nessuna opzione vince da sola; la composizione sì, purché la UI dica sempre cosa è provato e cosa no:

1. **World ID** → "è un umano unico e risponde con una sola identità" (provato).
2. **Self-claim "coach"** → "dice di essere un coach" (dichiarato, etichettato *autodichiarato* — mai mascherato da verifica).
3. **Reputazione ERC-8004** → "N runner paganti e verificati dicono che allena bene" (guadagnato).
4. **Attestazione federale / endorsement** → roadmap.

È lo stesso trust model dichiarato degli eventi ("sybil-resistant sì, verità di partecipazione no"): la coerenza è un argomento in pitch, non una debolezza.

## 3. Percorso MVP: claim onesto + reputazione guadagnata

- **Claim**: sul profilo, azione "Sono un coach" → verify World ID (riuso completo del flusso eventi: rp-context, IDKit, cloud-verify v4, anti-replay nullifier in Postgres — signal = `hash("coach-claim" + wallet)`) → `users.is_coach = true` + `coach_claim_nullifier UNIQUE`. Nessun contratto nuovo: il claim vive in DB, ancorato al nullifier; on-chain c'è già l'identità dell'agente (ERC-8004 IdentityRegistry).
- **Stati di fiducia in UI**: `Coach · autodichiarato` (0 review) → `Coach · N review verificate` (≥1 review gated). Nessuno stato "verificato" finché non esiste una verifica vera.
- **Review post-noleggio** (solo se il letting è live): al termine di una valutazione noleggiata, il renter (World-verified per costruzione? no — il renter non è necessariamente verificato: la review richiede verify World ID contestuale, stesso widget) lascia voto+testo → tx di pre-autorizzazione sul ReputationRegistry → payload su 0G Storage → indice DB. Un noleggio = al più una review.

## 4. Feature che valorizzano il coach umano

### Review umana dei report AI

Un runner noleggia il coach di un coach umano → report AI generato dalla pipeline esistente → il coach umano vede una coda "report in attesa di review" → aggiunge un'annotazione testuale. Il report mostra un **override visibile**: byline editoriale "Reviewed by *<nome>* — human coach" sopra il testo AI, annotazione chiaramente attribuita e distinta (mai fusa col testo del modello). Dati: `report_reviews` in Postgres (run_id, coach_user, testo, created_at); hash dell'annotazione su 0G Storage per provenance è opzionale, non MVP. **Nessuna scrittura in memoria del coach** — coerente col vincolo esistente (scrittura da chat = fuori MVP): l'annotazione è contenuto, non training.

### iNFT "allenato" dalla metodologia

Il coach umano minta il proprio coach come chiunque, poi un **onboarding metodologia**: wizard strutturato (filosofia, struttura settimanale tipo, approccio alle zone, workout preferiti, red flag che guarda per primi) scritto nel **coaching profile** — lo strato cifrato con chiave di servizio. Questo è il payoff della memoria a due strati: la metodologia è noleggiabile *by construction*, perché il letting carica già solo il profile e mai lo strato privato. Zero design nuovo sul confine di privacy.

### Q&A / office hours

MVP della feature (post-hackathon): thread asincrono — il renter di un report reviewed può fare 1-3 domande di follow-up, il coach risponde; solo DB. Office hours schedulate, calendario, video: fuori, sempre.

### Revenue share

Già nativo: `CoachRental` paga `pricePerRun` **direttamente all'owner** (design MVP §4). Il coach umano fissa il suo prezzo — presumibilmente più alto di un coach AI puro, ed è il mercato a dirlo. Fee di piattaforma: 0% in MVP, switch in roadmap. Tier separato "noleggio + review umana": roadmap (vedi open question).

### Badge nel design system

Regole del design system rispettate (orange = micro-dettagli, mai dominante):
- **Badge profilo**: micro-label uppercase `text-[10px] tracking-[0.25em]` navy, preceduta da linea `h-px w-8`; la linea diventa orange quando esiste ≥1 review verificata. Testo: `COACH · AUTODICHIARATO` / `COACH · 12 REVIEW`.
- **Byline sul report**: "Reviewed by *<nome>*" in Playfair italic, ocean blue, linea orange `h-px w-8` a precedere — parente stretto del badge "TEE verified", stessa famiglia di micro-proof.
- **Card coach nel letting**: `border-t-4 border-t-[#FF6B35]` (card in evidenza, già prevista) per i coach con review verificate.

## 5. Integrazioni track

- **World**: il coach umano è la versione più letterale di "human-backed agent" — AgentBook `lookupHuman(address)` collega l'iNFT a un umano verificato, e qui l'umano non è solo il proprietario: è la **fonte della metodologia** dell'agente e il supervisore dei suoi output. Più il gate World ID su claim e review. Da confermare al booth World che questo rientri in "AgentKit new use cases" (stessa domanda già in agenda per il claim eventi).
- **ERC-8004**: la registrazione IdentityRegistry è già nel design (bonus 1-2h); la reputazione qui la rende *viva* invece che decorativa: "l'agente è registrato E ha feedback verificati sul ReputationRegistry ufficiale, già deployato su Galileo, con payload su 0G Storage". Costo narrativo altissimo, costo tecnico basso — ma solo se il letting esiste in demo.
- **0G**: review payload e metodologia passano da 0G Storage; nessun servizio nuovo, solo più traffico sugli stessi.

## 6. Scope MVP, stime e cut-line

Priorità globale invariata: ciclo core 0G > eventi/World > ENS > letting > polish. Le feature qui sotto entrano **solo dopo** quella catena, con due eccezioni possibili a costo marginale (F1, e F2 se il letting è live).

| # | Feature | Stima | Quando |
|---|---|---|---|
| F1 | Claim "coach" (World ID) + badge profilo + stati fiducia | 2-3h | in-hackathon **se** l'integrazione World eventi è già live (riuso ~totale) |
| F2 | Review post-noleggio su ERC-8004 (tx + form + display + payload su Storage) | 3-4h | in-hackathon **solo se** letting in demo e registrazione 8004 fatta |
| F3 | Review umana dei report (coda + annotazione + byline) | 3-4h | post-hackathon |
| F4 | Onboarding metodologia → coaching profile | 3-4h | post-hackathon |
| F5 | Q&A thread asincrono | 2-3h | post-hackathon |

Totale pieno ~13-18h: non ci sta, e lo sappiamo prima di iniziare. **Cut-line realistica: F1 sola** (il badge da solo regge la slide "real coach" con una demo viva di 30 secondi); F2 è l'upgrade se sabato sera il letting funziona. F3-F5 sono roadmap pitchata, progettata, non costruita.

### Delta schema DB

- `users`: `+ is_coach boolean default false`, `+ coach_claim_nullifier text UNIQUE NULL`.
- `report_reviews` (F3): `id, run_id FK, coach_user_id FK, body text, created_at`.
- `coach_feedback` (F2, indice della reputazione on-chain): `id, coach_token_id, reviewer_user_id, rental_id FK UNIQUE, rating, body_root (rootHash su 0G Storage), tx_ref, nullifier UNIQUE per rental`.

Nessuna migration tocca tabelle esistenti oltre le due colonne su `users`: F1 è additiva e reversibile.

### Rischi demo

- F1 riusa il verify World: se il flusso eventi non è stato testato col telefono verificato (già in checklist MVP), F1 eredita lo stesso blocco — nessun rischio nuovo, stesso prerequisito.
- F2 aggiunge una tx per review: receipt pattern come per tutto il resto (la review fallita on-chain resta in DB come `pending`, mai persa, mai finta).
- Il badge "autodichiarato" può sembrare debole in demo: si difende a voce come scelta di onestà del trust model — è la stessa linea già dichiarata per gli eventi, e regge meglio di un "verified" finto smontabile con una domanda.

### Cosa NON facciamo (mai in questo MVP)

- Verifica di credenziali federali fatta da noi (né manuale né "attestata dall'organizzatore") — o firmano le federazioni, o è roadmap.
- Endorsement a catena, stake/slashing, reputazione pesata.
- Etichetta "verified coach" senza una verifica reale dietro: il self-claim resta *autodichiarato* in UI, sempre.
- Scrittura delle annotazioni umane nella memoria dell'agente.
- Fee di piattaforma, tier di prezzo, payout splitting.
- Office hours schedulate, calendario, video, notifiche.
- KYC o upload documenti di qualunque tipo.

## 7. Riferimenti

- ERC-8004 su Galileo: IdentityRegistry `0x8004A818BFB912233c491871b3d84c89A494BD9e` · ReputationRegistry `0x8004B663056A597Dffe9eCcC1965A193B7388713` · 8004scan.io
- Flusso World ID riusato: design MVP §5 (IDKit v4 cloud-verify, signal binding, anti-replay Postgres — pattern provenance-miniapp con bug corretti)
- Letting e memoria a due strati: design MVP §3-§4; `OrunAgentNFT.authorizeUsage` + `CoachRental` (decisions.md: vendor 0G scartato per EIP-170, OrunAgentNFT autoritativo)

## Decisioni prese (2026-07-25, Ivan)

- **Coach umano in demo**: un membro del team verificato con World ID che si **autodichiara** coach. Nessun tentativo di far passare l'autodichiarazione per una verifica formale: il badge in UI dice "autodichiarato" e in Q&A si spiega la scala di fiducia (umano unico verificato → self-claim → reputazione guadagnata).
- Conseguenza: F1 (claim + badge) resta l'unico pezzo in-hackathon; niente reclutamento di coach esterni alla Morning Run.
