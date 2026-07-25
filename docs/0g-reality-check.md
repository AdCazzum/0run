# 0G Galileo — numeri misurati (2026-07-25)

Misurazioni reali fatte dal wallet tesoreria `0x7CAd48f536fC2d23dEa4756d6C601f9C065B6877` sulla testnet Galileo (chainId 16602) con i dati veri di Ivan, non con fixture sintetiche. Servono a due cose: guidare le decisioni architetturali e dare ai giudici numeri difendibili invece di claim generici.

## Chain — funziona bene, costa niente

| Operazione | Esito | Costo |
|---|---|---|
| Deploy `OrunAgentNFT` + `CoachRegistry` | ✅ | 0.0076 OG totali |
| `mint([IntelligentData], to)` → tokenId 1 | ✅ tx `0x28b9c02e26e8735d3ab9e474a49669069a21f0e1e6898f2cd2c05def1a24799d` | trascurabile |
| `CoachRegistry.update(1, memoryRoot, profileRoot)` → runCount 1 | ✅ tx `0x5d3ebbc6dbd2e35085ebc86df8bccb6e286b61b13d6b438a55a924987026d812` | trascurabile |

Indirizzi live: AgentNFT `0x3df1e8029ce2360ABdfECD0fcc966B04F76eaf9e`, CoachRegistry `0x08b3a841393ab09A4C902800C55d24e6AF66945f`. Bytecode verificato con `eth_getCode`. Dei 6 OG iniziali ne restano ~5.99: la chain non è un vincolo.

## Compute — funziona, ~20s, con prova di pagamento

Report del coach su un GPX reale, prompt completo, profilo `drill_sergeant`:

- **JSON valido al primo tentativo**, nessun retry: `glm-5.2`, `finish_reason: stop`
- **latenza 19.5s**, 1274 token di output di cui **789 di reasoning**
- `x_0g_trace`: provider `0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D`, request id `13eed4ff-2b82-4418-b241-392708839536`, costo on-chain input+output

Due conseguenze. Primo: **non serve impostare `max_tokens`** — il budget di default del router copre anche un modello reasoning su prompt pieni (il dubbio era legittimo: con `max_tokens: 20` lo stesso modello restituisce contenuto *vuoto* perché spende tutto in ragionamento). Secondo: `x_0g_trace` è l'artefatto che il bando 0G chiede come prova d'uso di 0G Compute — va mostrato nella submission.

### Router contro Direct: attestazione o qualità, misurato

| | Router (`glm-5.2`) | Direct (`qwen2.5-omni-7b`) |
|---|---|---|
| Attestazione per risposta | assente (solo provider TEE-acknowledged) | **`processResponse` → `true`** |
| Latenza | 19,5 s | **1,07 s** |
| Pagamento | credito prepagato su pc.0g.ai | on-chain dalla tesoreria (ledger 4 OG) |
| Qualità del coaching | usa la memoria, resta in personaggio: *"Stesso run, stessi numeri, zero progresso. Svegliati."* | **ignora il contesto**: *"non so come stai procedendo senza vedere i dati"* — con i dati presenti nel prompt |

La rete Direct espone **un solo modello chat** (verificato con `broker.inference.listService()`: 2 servizi totali, uno è image-edit). Quindi la scelta è secca e va dichiarata: l'unico path che attesta crittograficamente ogni risposta è anche quello che produce il coach peggiore. `INFERENCE_PREFER` decide l'ordine e l'altro path resta fallback automatico, così la configurazione è una decisione di prodotto e non un vincolo del codice.

Nota di implementazione costata tempo: la build **ESM dell'SDK Compute è rotta** (`does not provide an export named 'C'` su 0.9.0). Va caricata la build CommonJS via `createRequire`, altrimenti abilitare il path Direct fallisce a runtime e ricade silenziosamente sul router — cioè sembra funzionare finché il router ha credito.

### Lo split: report sul router, effort score sul direct

La tabella sopra è una scelta secca solo se si tratta il coaching come un'unica chiamata. Non lo è: il prodotto separa esplicitamente due output.

- **Il report narrativo** (headline, analisi, confronto, consigli) resta sul **router / `glm-5.2`**: usa la memoria, resta in personaggio, è il prodotto — comportamento invariato.
- **L'effort score 1-5** (`apps/web/src/lib/coach/score.ts`) va SEMPRE sul **direct / `qwen2.5-omni-7b`**, chiamando `directComplete` esplicitamente e mai `coachComplete` — quindi indipendentemente da `INFERENCE_PREFER`. Un numero singolo derivato da statistiche già aggregate è esattamente ciò che un modello 7B sa fare bene, ed è anche l'unica parte che qualcuno potrebbe contestare o falsificare: è lì che la provenienza tamper-proof conta davvero. Lo score viene poi iniettato nel prompt del report (`buildReportMessages`), così il modello grande lo cita invece di ricalcolarlo.

**Cosa dimostra l'attestazione, e cosa no.** `processResponse → true` dimostra che *quella risposta* è stata prodotta da *quel modello* dentro una TEE, sui dati sottomessi in quella richiesta. Non dimostra che il GPX sia genuino, né che le statistiche aggregate passate nel prompt siano vere — l'attestazione copre l'inferenza, non la provenienza dei dati a monte. Nessuna copia del prodotto deve implicare il contrario.

Lo score è pensato come **effort/intensità relativo alla storia dell'atleta stesso** (1 = recupero, 5 = massimale), mai una scala assoluta: confrontare corridori diversi su una scala fissa non avrebbe senso, quindi il prompt àncora esplicitamente il modello al trend di passo recente di quello stesso atleta. Se il path direct fallisce (singolo provider, testnet, cade spesso — vedi tabella sopra), `scoreRun` non lancia mai e non inventa un numero: ritorna un esito `{ ok: false }` che la pipeline marca come step `error` senza far fallire la corsa — il report resta il prodotto, lo score è un arricchimento.

## Storage — l'upload funziona, la lettura no (nel tempo di una demo)

Questo è il vincolo che ha cambiato l'architettura.

| Fatto misurato | Numero |
|---|---|
| Upload cifrato di un GPX reale (658 KB) | tx confermata, merkle root `0x0c173a56dc7257e398296c1d1e1636d6762e6fd024e0d32984145481e0d33a3b` |
| Disponibilità del file appena caricato | **> 22 minuti di polling continuo e ancora `{"code":101,"message":"File not found"}`** (misurato dal controller, campione ogni 20s) |
| Risposta dei nodi storage durante il polling | `Log entry is available, but not finalized yet` (`finalized: false`) |
| Caso peggiore osservato su un secondo upload | `indexer.upload()` **non è mai ritornato in ~24 minuti** — nessun timeout interno all'SDK, mentre la tx on-chain era andata a buon fine (nonce +2, −0.002476 OG) |

### Cosa abbiamo cambiato per questo

1. **La memoria del coach non si rilegge da Storage nel percorso caldo.** Un blob appena caricato non è scaricabile, quindi la prima corsa dopo il mint avrebbe fallito per *ogni* utente — incluso un giudice che prova l'app dal telefono. La memoria cifrata sta in cache nel DB (envelope AES, nessun plaintext a riposo); Storage resta la copia durevole e verificabile ancorata on-chain; il download da Storage serve solo nel re-sync, dove i blob sono vecchi e finalizzati.
2. **Ogni chiamata all'SDK è ora sotto timeout** (upload 120s per tentativo, download 30s): un hang indefinito viola la promessa del receipt pattern quanto un'eccezione. Su timeout l'errore dichiara esplicitamente che la submission on-chain **può essere andata a buon fine comunque** — perché è ciò che abbiamo osservato.
3. **La pipeline di upload è asincrona con stato visibile** (non era solo una scelta estetica): l'utente vede avanzare cifratura → upload → memoria → tx → inferenza invece di una richiesta che sembra bloccata.

### Cosa resta vero nel pitch

Il claim "i tuoi dati vivono cifrati su 0G" è verificabile a prescindere dalla lentezza della lettura: la tx di upload e il merkle root sono pubblici e ispezionabili su `storagescan-galileo.0g.ai`. Ciò che **non** possiamo promettere su questa testnet è il recupero immediato dopo la scrittura — e la demo non deve dipenderne. Per lo stesso motivo la demo "ammazzo il DB → re-sync" resta fuori: la ricostruzione richiede letture da Storage, quindi si racconta a parole con il runbook come prova.
