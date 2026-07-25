# 0run — Upload dati sanitari (Apple Health) a integrazione delle corse

**Data:** 2026-07-25 · **Stato:** proposta · **Dipende da:** [design MVP](./2026-07-24-0run-mvp-design.md), [design system](./2026-07-24-0run-design-system.md)

## 1. Obiettivo

Il coach oggi vede solo le corse (GPX). Un runner però si allena con tutto il corpo: sonno, HRV e FC a riposo dicono al coach *quando* spingere e quando no. Questa feature aggiunge l'upload di un export JSON di Apple Health, ne estrae un **healthSnapshot aggregato** nello strato privato della memoria, e abilita **recovery advice** nei report e in chat. Valore per il track 0G: più dati cifrati per-utente su 0G Storage → il claim "un coach che possiedi, con la TUA memoria" diventa più concreto; la pipeline (cifra → 0G → memoria → registry → inferenza) è la stessa dei GPX, riusata al 90%.

**Invariante non negoziabile:** il coaching profile pubblico (cifrato con chiave di servizio, letto dal letting) **non contiene mai dati sanitari**. Il confine di privacy resta il confine delle chiavi: la salute vive solo nello strato privato (chiave utente).

## 2. Formato di input (analisi dell'export reale)

Analizzato un export reale (11 MB, JSON): formato prodotto da un'app iOS di export (`metadata.export_format: "json"`, `app_version: "1.2"`, aggregazione `raw`), **non** l'`export.xml` nativo di Apple Health. Struttura:

```
{ date_range: {days, start, end},      // finestra 7 giorni nell'esemplare
  export_date, metadata,
  metrics: [ {id: "HKQuantityTypeIdentifier…", display_name, unit, data_points: [{value, unit, start_date, end_date, source}]} ],
  category_metrics: [ {category: "Sleep", data_points: [{value, label, start_date, end_date, source}]} ],
  workouts: [ {type, duration, energy, distance?, start_date, end_date, source, id} ] }
```

Contenuto dell'esemplare (solo cardinalità, mai valori): 18 metriche quantitative, ~31.350 datapoint in 7 giorni. Rilevanti: HeartRate 10.956 punti (continuo), StepCount 2.217 (source "HealthKit (Aggregated)" — già dedupato dall'app), ActiveEnergy 5.934, HRV SDNN 66 (~9/giorno), RestingHeartRate **5 punti su 7 giorni** (giorni mancanti: il parser deve tollerare buchi), RespiratoryRate 269, OxygenSaturation 114, misure corporee 1 punto ciascuna. Sonno: 150 segmenti con `label` incoerenti rispetto all'enum HealthKit (`label: "unknown"` con `value: 4` = asleepDeep in HK) → **il parser si fida del `value` numerico** (HKCategoryValueSleepAnalysis: 0 inBed, 2 awake, 1/3/4/5 dormito), mai della label. Workouts: 9 (6 running, 3 strength_training) — le sessioni di forza sono un segnale di carico che i GPX non vedono. **VO2max assente** dall'export reale: nello schema è opzionale, non un requisito.

## 3. Selezione metriche per il coaching

| Metrica | Teniamo? | Perché |
|---|---|---|
| Resting HR (giornaliera) | ✅ | segnale n.1 di recupero/overtraining; 1 valore/giorno, perfetto per il prompt |
| HRV SDNN (media giornaliera) | ✅ | readiness: calo vs baseline = giorno scarico; azionabile |
| Sonno (min/notte, da segmenti) | ✅ | recovery advice credibile parte da qui; aggregato per notte |
| Passi/giorno | ✅ | carico non-running (NEAT); contestualizza la fatica |
| Active energy kcal/giorno | ✅ | proxy carico totale giornaliero |
| VO2max (se presente) | ✅ opz. | fitness baseline; assente nell'esemplare → nullable |
| Workouts non-running (count/tipo) | ✅ | cross-training che il coach altrimenti ignora |
| HeartRate continuo | ❌ | 11k punti ridondanti: la FC in corsa è già nel GPX; nel prompt sarebbe rumore |
| Walking speed/step length/asymmetry | ❌ | gait analysis fuori scope coaching running MVP |
| SpO2, respiratory rate | ❌ | bassa azionabilità, rischio di scivolare in consigli medici |
| Peso/BMI/body fat/lean mass | ❌ | massimamente sensibili, non azionabili settimana su settimana |
| Basal energy, flights climbed | ❌ | costante fisiologica / rumore |

Compressione: 11 MB raw → snapshot ~2 KB. La memoria del coach resta piccola e il prompt sotto controllo (ctx 32k sul fallback testnet).

## 4. Parser server-side

`apps/web/src/lib/health/parse.ts` — `parseHealthExport(json: unknown): HealthSnapshot`.

- **Zod tollerante in input**: schema lasco con `.passthrough()`/campi opzionali — l'app di export cambierà versione; si valida solo ciò che si consuma. Metrica riconosciuta dall'`id` HK (`HKQuantityTypeIdentifierRestingHeartRate`, ecc.), mai da `display_name` (localizzabile).
- **Aggregazione per giorno** (chiave `YYYY-MM-DD`): RHR = valore del giorno (ultimo se più d'uno); HRV = media dei sample del giorno; passi/kcal = somma; sonno = somma durate dei segmenti con `value ∉ {0, 2}`, **attribuita alla data di `end_date`** (la notte appartiene al giorno di sveglia).
- Giorni senza dato → campo `null`, il giorno resta nell'array (il coach deve poter dire "non ho il sonno di ieri").
- **Baseline** = media dei valori non-null della finestra (RHR, HRV, sonno): serve al prompt per i delta ("HRV −18% vs la tua media").
- Unit test su fixture **sintetica** (mai l'export reale nel repo: sono dati sanitari veri) + edge case: metrica assente, giorno bucato, label sonno incoerenti, export vuoto.

## 5. Schema: CoachMemory v2 e HealthSnapshot

In `packages/shared/src/types.ts`:

```ts
const DailyHealthSchema = z.object({
  date: z.string(),                       // YYYY-MM-DD
  sleepMin: z.number().min(0).nullable(),
  restingHr: z.number().positive().nullable(),
  hrvSdnnMs: z.number().positive().nullable(),
  steps: z.number().min(0).nullable(),
  activeKcal: z.number().min(0).nullable(),
});
export const HealthSnapshotSchema = z.object({
  source: z.literal("apple-health-json"),
  exportedAt: z.string(),
  windowDays: z.number().int().positive(),
  days: z.array(DailyHealthSchema).max(30),
  baselines: z.object({ restingHr: z.number().nullable(), hrvSdnnMs: z.number().nullable(), sleepMin: z.number().nullable() }),
  vo2max: z.number().nullable(),
  otherWorkouts: z.array(z.object({ type: z.string(), count: z.number().int().min(0) })),
});
```

**Retrocompatibilità** (memorie v1 già cifrate su 0G Storage, non riscrivibili in massa):

- `CoachMemorySchema` diventa v2: `version: z.literal(2)`, `privateLayer: { runs, health: HealthSnapshotSchema.optional() }`.
- Lettura via nuova `parseMemory(json): CoachMemory` in `memory.ts`: prova v2, poi v1 (schema congelato `CoachMemoryV1Schema`) → migra (`version: 2`, `health: undefined`). Upgrade lazy: la memoria viene riscritta come v2 al prossimo `persistMemory` — che aggiorna comunque hash e registry, quindi nessun costo extra.
- **Trappola zod evitata:** niente `z.union().transform()` sullo schema esportato (cambierebbe il tipo inferito ovunque); la migrazione è una funzione esplicita, lo schema v2 resta la fonte dei tipi.
- Nuovo upload sostituisce lo snapshot **integralmente** (ultimo export vince): idempotente, niente merge di finestre sovrapposte. Merge per unione di date = stretch.
- `CoachProfileSchema` **non cambia** (resta version 1): `buildProfile()` non legge `privateLayer.health`. Test di regressione privacy: `JSON.stringify(buildProfile(memoryConHealth))` non contiene alcuna chiave/valore di `HealthSnapshotSchema`.

## 6. Pipeline upload e storage

`POST /api/health/upload` (auth `requireUser`, body: file JSON + firma per derivare la chiave utente — stesso flusso dei GPX):

1. Parse + snapshot (sezione 4). File > 25 MB o JSON invalido → 400 con receipt d'errore.
2. **Upload dell'export raw cifrato su 0G Storage con la chiave utente** (riuso `uploadEncrypted`, identico ai GPX) → `healthRoot`. Trade-off dichiarato: 11 MB su testnet sono lenti (~decine di secondi) ma è il claim onesto "i TUOI dati sanitari, cifrati con la TUA chiave, su 0G" e permette re-parse futuri; se in demo l'upload raw è troppo lento, fallback consapevole = caricare solo lo snapshot (che vive comunque nella memoria) e dichiararlo. Dedup SDK: stesso export → stesso rootHash → gestire "already-finalized" (già fatto in `storage.ts`).
3. `parseMemory` sulla memoria corrente → `memory.privateLayer.health = snapshot` → `persistMemory` (ri-cifra entrambi gli strati; il profile non cambia contenuto → rootHash identico → "already-finalized", gratis).
4. Tx `CoachRegistry.update(tokenId, memoryRoot, profileRoot)` — la stessa tx-per-aggiornamento che mostriamo per le corse.
5. DB (solo indice, **zero valori sanitari in Postgres**): tabella `health_uploads` (`id, user_id, health_root, window_days, days_with_data, metrics_present text[], exported_at, created_at`). La UI legge da qui solo la *copertura* ("Sonno · FC riposo · HRV · Passi — 7 giorni"), mai i valori.

Pipeline a stati come per le corse (3 step: Cifratura → Upload 0G → Memoria aggiornata (tx)), receipt pattern, mai fallback su dati finti.

## 7. Impatto sui prompt

`prompts.ts`: `buildReportMessages` e `buildChatMessages` accettano `health?: HealthSnapshot` (viene dallo strato privato decifrato, quindi **strutturalmente assente** nel path letting, che carica solo il profile). Se presente, blocco `Recovery context` nel messaggio user:

- ultimi 3-5 giorni in forma compatta (data, sonno, RHR, HRV) + baseline;
- delta calcolati **dal backend**, non chiesti al modello ("HRV oggi −18% vs baseline; sonno ieri 5h10 vs media 6h40") — i modelli su 0G sbagliano l'aritmetica;
- istruzione: modulare l'advice sul recupero (sonno corto/HRV depresso → scarico o intensità ridotta; segnali buoni → via libera a qualità), citando i numeri;
- guardrail: "you are a running coach, not a doctor — no medical advice, suggest a professional for anything clinical".

Il `systemPrompt` (dal profile) non cambia: la personalità decide il *tono* del recovery advice (il Drill Sergeant ti manda a dormire in un altro modo). Valore demo: stessa corsa con e senza health → l'advice cambia = la memoria determina il comportamento, secondo asse dopo le personalità.

## 8. UI (profilo, design system Luxury/Editorial)

Sezione "Salute" nella pagina profilo, sotto le statistiche corse:

- Blocco editoriale: linea decorativa `h-px w-12` + overline uppercase `tracking-[0.3em]` "HEALTH DATA / VOL. 01"; titolo Playfair con italic orange ("Your *Recovery*, encrypted").
- Dropzone: bordo `1px` navy (solo `border-t` + `border-b`), radius 0, testo Playfair italic ocean per l'istruzione, hover con layer orange slide (pattern Button primary). Accetta un solo `.json`.
- Pipeline a stati riusata dalle corse: label uppercase, spunte lente in orange, link tx a chainscan e rootHash a storagescan.
- Stato "dati presenti": card `border-t` con la sola copertura (metriche presenti + finestra + data export) e micro-label "Encrypted with your key — visible only to your coach". **Niente grafici né valori nell'MVP: l'interfaccia ai tuoi dati sanitari è il coach.** Micro-istruzioni per generare l'export dall'app iOS (nome app da confermare, vedi open questions).

## 9. Privacy

- Profile pubblico senza salute: garantito da codice (`buildProfile` non tocca `health`), da test di regressione (sezione 5) e da architettura (chiavi diverse).
- Postgres: solo metadati di copertura, mai valori. I valori esistono solo cifrati su 0G o in RAM durante parse/inferenza.
- Limite dichiarato (identico ai GPX, ma qui pesa di più — dati ex art. 9 GDPR): il backend vede il plaintext durante il parse. Mitigazioni MVP: nessun log del payload, nessuna scrittura su disco, buffer solo in memoria. Roadmap: 0G Private Computer.
- L'export reale usato per l'analisi non entra nel repo; le fixture di test sono sintetiche.
- Letting: il renter non può ricevere recovery advice dal coach noleggiato (non ha lo strato privato) — comportamento corretto, da dichiarare in UI.

## 10. Scope MVP, stima ore, cut-line

Posizione nell'ordine di build: **dopo** il ciclo core (login→mint→upload→report) e chat; è un differenziatore per il track 0G, non un prerequisito.

| Task | Ore |
|---|---|
| Parser + fixture sintetiche + test | 3 |
| Schema v2 + `parseMemory` migrazione + test retrocompat/privacy | 2 |
| Route upload + storage raw + registry + DB | 2,5 |
| Prompt (recovery context + delta backend) | 1,5 |
| UI sezione profilo + pipeline stati | 3 |
| Smoke E2E (upload health → report con recovery advice) | 1 |
| **Totale** | **~13** |

**Cut-line — cosa NON facciamo:** parsing di `export.xml` nativo Apple (ZIP da centinaia di MB, XML: solo il formato JSON dell'app di export) · sync automatico/HealthKit API (solo upload manuale) · grafici e dashboard salute · merge di export multipli (replace integrale) · SpO2/respirazione/composizione corporea · trend multi-settimana (finestra = quella dell'export, max 30 giorni) · health nel coaching profile o nel letting (mai, non è un cut: è un invariante) · alert/notifiche di recupero.

**Cut interni se manca il tempo** (dal fondo): UI ridotta a dropzone+stato senza polish → niente upload raw su 0G (solo snapshot in memoria, dichiarato) → feature intera (il ciclo core non ne dipende).

## 11. Riferimenti

- Codice toccato: `packages/shared/src/types.ts` · `apps/web/src/lib/coach/{memory,prompts}.ts` · `apps/web/src/lib/zerog/storage.ts` (riuso) · `apps/web/src/db/schema.ts` · nuova `apps/web/src/lib/health/` · nuova route `apps/web/src/app/api/health/upload/`.
- Enum sonno: HKCategoryValueSleepAnalysis (Apple HealthKit docs) — fidarsi del `value`, non delle label dell'app di export.
