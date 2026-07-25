# Decisioni tecniche

## AgentNFT: vendor 0gfoundation/0g-agent-nft vs fallback OrunAgentNFT

**Data:** 2026-07-25
**Contesto:** Task 9 (contratti). Il repo `0gfoundation/0g-agent-nft` implementa ERC-7857 ("intelligent NFT") su due branch: `main` e `eip-7857-draft`. Bisognava scegliere quale vendorizzare per `AGENT_NFT_ADDRESS`, con criterio di selezione: la `mint` deve combaciare con `mint(IntelligentData[] calldata, address) payable returns (uint256)` e deve esporre `intelligentDatasOf(uint256)` view.

**Repo ispezionati (shallow clone, non nella history di questo repo):**
- `main` — commit `b86e108a49bf3601bf57f1f0b3166dce2cb15928` (2026-02-02)
- `eip-7857-draft` — commit `3b32a607fc9788dbd754b1f640b824083a81cdfc` (2025-05-27)

### Evidenza firme mint

**`main` — `contracts/AgentNFT.sol`:**
```solidity
function mint(IntelligentData[] calldata iDatas, address to) public payable virtual whenNotPaused returns (uint256 tokenId)
```
→ **Combacia** con il criterio (`IntelligentData[] calldata` + `address to`, `payable`, `returns (uint256)`).
Espone anche `intelligentDatasOf(uint256)` come `public view` (ereditata da `ERC7857Upgradeable.sol:176`), con struct `IntelligentData { string dataDescription; bytes32 dataHash; }` (in `interfaces/IERC7857Metadata.sol`) — stessi campi del fallback.

**`eip-7857-draft` — `contracts/AgentNFT.sol`:**
```solidity
function mint(bytes[] calldata proofs, string[] calldata dataDescriptions, address to) public payable virtual returns (uint256 tokenId)
```
→ **Non combacia**: richiede array di `proofs` (TEE/ZK preimage proofs verificati da un `IERC7857DataVerifier` esterno) invece di `IntelligentData[]`. Nessun `intelligentDatasOf`; espone invece `dataHashesOf` / `dataDescriptionsOf` separati.

**Conclusione selezione:** `main` è il branch atteso dal criterio → si procede a vendorizzarlo.

### Presenza di `authorizeUsage`

- **`main`:** sì — `authorizeUsage(uint256 tokenId, address to)` in `extensions/ERC7857AuthorizeUpgradeable.sol` (più `batchAuthorizeUsage`, `revokeAuthorization`, `clearAuthorizedUsers`).
- **`eip-7857-draft`:** sì — `authorizeUsage(uint256 tokenId, address to)` definito direttamente in `AgentNFT.sol` (via `IERC7857` legacy interface), nessun `revoke`.

Entrambi i branch hanno un concetto di "authorize usage"; solo `main` combacia però sul resto dell'interfaccia richiesta.

### Tentativo di vendoring `main` — esito: FALLITO, vendor scartato

Passi eseguiti:
1. `cp -r /tmp/0g-agent-nft-main/contracts contracts/contracts/vendor` (17 file: `AgentNFT.sol`, `AgentMarket.sol`, `ERC7857Upgradeable.sol`, `TeeVerifier.sol`, `Utils.sol`, `extensions/*`, `interfaces/*`, `proxy/*`, `verifiers/*`).
2. `npx hardhat compile` → fallito inizialmente: `@openzeppelin/contracts-upgradeable` mancante (aggiunto `5.0.2`, pin coerente col `package.json` originale del vendor).
3. Secondo fallimento: `TypeError: The "mcopy" instruction is only available for Cancun-compatible VMs (you are currently compiling for "paris")` in `@openzeppelin/contracts/utils/Bytes.sol` — causato dall'avere `@openzeppelin/contracts@^5.6.1` (richiesto per il fallback, che usa `_requireOwned`) mentre il vendor si aspettava `5.0.2`. **Fix:** pin `@openzeppelin/contracts` a `5.0.2` esatto (compatibile sia col vendor sia col fallback, nessun uso di `mcopy`/Cancun — più sicuro anche per compatibilità con chain EVM che potrebbero non supportare l'hard fork Cancun).
4. Con questo pin, `npx hardhat compile` è riuscito: **53 file Solidity compilati**, ma con un warning esplicito:
   > `Warning: Contract code size is 24674 bytes and exceeds 24576 bytes (a limit introduced in Spurious Dragon). This contract may not be deployable on Mainnet.` (riferito a `contracts/vendor/AgentNFT.sol`)
5. Scritto un test "spike" adattato (deploy dietro `UpgradeableBeacon` + `BeaconProxy`, dato che il costruttore chiama `_disableInitializers()` e quindi `initialize()` non è chiamabile su un'istanza diretta — serve per forza un proxy) che replica il test del fallback (`mint` con `IntelligentData[]`, verifica `ownerOf` e `intelligentDatasOf`).
6. Esecuzione del test spike su rete locale Hardhat (EDR, che applica lo stesso limite EIP-170 di mainnet): **fallita al deploy dell'implementazione**, non al mint:
   ```
   Error: Transaction reverted: trying to deploy a contract whose code is too large
     at AgentNFT.constructor (contracts/vendor/AgentNFT.sol:82)
   ```

**Causa radice:** `AgentNFT.sol` di `main` eredita contemporaneamente `AccessControlUpgradeable`, `ReentrancyGuardUpgradeable`, `PausableUpgradeable`, `ERC7857CloneableUpgradeable`, `ERC7857AuthorizeUpgradeable`, `ERC7857IDataStorageUpgradeable` (oltre a `mintWithRole` in 4 overload per `AgentMarket`, gestione fee/creator, ecc.) — il bytecode compilato supera il limite EIP-170 di 24576 byte (24674 byte, ~98 byte oltre) anche con `optimizer` + `viaIR` attivi. Il contratto compila ma **non è deployabile** su nessuna chain EVM che applichi il limite standard (praticamente tutte, incluso presumibilmente 0G Galileo).

**Decisione:** per il criterio esplicito del task ("se il vendor compila e il suo test di mint passa, usare il vendor" — qui compila ma il mint/deploy **non passa**), il vendor viene **scartato**. La cartella `contracts/contracts/vendor/` è stata rimossa dal repo dopo l'esperimento (non committata). `OrunAgentNFT.sol` è **autoritativo per l'MVP**.

**Possibili strade future** (fuori scope MVP, solo annotate): rifattorizzare il vendor rimuovendo `AgentMarket`/fee-distribution/creator-tracking non necessari per l'MVP, o usare `mintWithRole`/split in più contratti per stare sotto 24KB; oppure aspettare un eventuale slimming upstream. Nessuna delle due è stata tentata per rispettare il timebox.

### Stato finale

- `AGENT_NFT_ADDRESS` → deployment di `OrunAgentNFT.sol` (fallback, subset ERC-7857-style: `mint`, `intelligentDatasOf`, `ownerOf`, `authorizeUsage`).
- `@openzeppelin/contracts` pinnato a `5.0.2` esatto in `contracts/package.json` (non `^5.6.1`) per evitare la dipendenza da `mcopy`/Cancun in `Strings.sol`/`Bytes.sol`, mantenendo comunque `_requireOwned` (introdotto in OZ 5.0).
- Nessun deploy eseguito su `zgTestnet` (wallet senza fondi, come da amendment del controller). `contracts/scripts/deploy.ts` è pronto e verificato solo sulla rete locale Hardhat in-memory.
- `AGENT_NFT_ADDRESS` / `COACH_REGISTRY_ADDRESS` in `.env` restano da compilare quando si eseguirà il deploy reale su Galileo (fuori scope di questo task).

## Deploy reale su Galileo + spike 0G Storage/inference (dati reali)

**Data:** 2026-07-25
**Contesto:** treasury `0x7CAd48f536fC2d23dEa4756d6C601f9C065B6877` finanziato con 6 OG. Deploy reale eseguito, sanity-check on-chain, spike di storage e inferenza con dati reali (non mock).

### A. Deploy contratti (rete `zgTestnet`, chainId 16602)

| Contratto | Indirizzo | Explorer |
|---|---|---|
| `OrunAgentNFT` (`AGENT_NFT_ADDRESS`) | `0x3df1e8029ce2360ABdfECD0fcc966B04F76eaf9e` | https://chainscan-galileo.0g.ai/address/0x3df1e8029ce2360ABdfECD0fcc966B04F76eaf9e |
| `CoachRegistry` (`COACH_REGISTRY_ADDRESS`) | `0x08b3a841393ab09A4C902800C55d24e6AF66945f` | https://chainscan-galileo.0g.ai/address/0x08b3a841393ab09A4C902800C55d24e6AF66945f |

Entrambi scritti in `.env`. `eth_getCode` confermato non vuoto su entrambi al momento del deploy.

Tx di deploy:
- `OrunAgentNFT`: `0x787a4b08b2d02e536df79c0461e3c09aaacc73886f83405053e90d94d262c943` (block 45803362, gasUsed 1176655) — https://chainscan-galileo.0g.ai/tx/0x787a4b08b2d02e536df79c0461e3c09aaacc73886f83405053e90d94d262c943
- `CoachRegistry`: `0x4a125c951f3608a5c350eaf60380df46c23a74a751773a031925ecbcb14964a5` (block 45803377, gasUsed 180410) — https://chainscan-galileo.0g.ai/tx/0x4a125c951f3608a5c350eaf60380df46c23a74a751773a031925ecbcb14964a5

Sanity-call dal signer treasury (che coincide col deployer/backend):
- `CoachRegistry.update(1, keccak256("m1"), keccak256("p1"))` → tx `0x5d3ebbc6dbd2e35085ebc86df8bccb6e286b61b13d6b438a55a924987026d812` (block 45803643, gas 90884). Lettura `memoryOf(1)`: `memoryRoot=0x83267a439473d40c510063b30f7c06d1e3bf496ea5e34c5e3290dfc7dc527ce1`, `profileRoot=0x260e065801cba6ca065f28640c3d94ef235f67db5431448aae1a51af7214efaf`, `runCount=1` ✓ (asserzione passata).
- `OrunAgentNFT.mint([{dataDescription:"0g://storage/0xtest", dataHash:keccak256("ct")}], treasury)` → tx `0x28b9c02e26e8735d3ab9e474a49669069a21f0e1e6898f2cd2c05def1a24799d` (block 45803672, gas 144114), `tokenId=1`. `intelligentDatasOf(1)` combacia, `ownerOf(1)==treasury` ✓ (asserzioni passate).
- Costo combinato update+mint: 0.000939992001644986 OG (balance 5.994571739990500545 → 5.993631747988855559).

### B. Spike 0G Storage — round trip reale: BLOCCATO su finalità, non fake

Script throwaway (`/tmp`, mai committato) ha importato direttamente `apps/web/src/lib/zerog/storage.ts` (nessuna modifica al file) e chiamato `uploadEncrypted()` su una fixture GPX reale (`scripts/fixtures/real/20260721-093240-Running-21-7-2026-10-32-6765CE8D.gpx`, 658359 byte) con chiave simmetrica random a 32 byte.

**Evidenza di invio on-chain reale** (non fabbricata):
- Nonce treasury: 4 → 6 (2 tx minate) durante la finestra di upload.
- Balance treasury: 5.993631747988855559 → 5.991155480096399 OG (delta **-0.002476267892456363 OG**, interamente attribuibile all'upload — nessun'altra attività nel mezzo).
- `dataMerkleRoot` osservato in modo stabile per l'intera finestra (~24 minuti) nel trace di debug interno dell'SDK, e **riconfermato con una chiamata diretta `zgs_getFileInfo` allo storage node** (`http://34.83.53.209:5678`) al momento della stesura di questo report: `rootHash = 0x2bd3d835b4b8b681949495646ef5703002ac6f1a0df25be28c176d48541994c4`, `size=658376` byte (== 658359 raw + 17 byte header di cifratura SDK, combacia).
- `finalized: false` in **ogni** osservazione, inclusa quella finale diretta.

**Esito:** `uploadEncrypted()` **non è mai tornato** (né `ok:true` né `ok:false`) entro ~24 minuti di wall-clock reale. Causa root: `Uploader.waitForLogEntry()` nell'SDK (`node_modules/@0gfoundation/0g-storage-ts-sdk/lib.esm/transfer/Uploader.js`, funzione `waitForLogEntry`) fa polling ogni 1s in un `while(true)` **senza alcun retry cap** quando `finalityRequired` è true — quindi la nostra funzione `doUpload`/`uploadEncrypted` resta bloccata finché lo storage node non segnala `finalized:true`, che sulla rete reale Galileo non è avvenuto in questa finestra. Il processo background è stato infine terminato dall'harness (~24 min).

Di conseguenza:
- **Nessun `txHash` catturato** dal valore di ritorno della funzione (non è mai tornata `ok:true`).
- **`downloadDecrypted()` mai tentato** (per istruzione esplicita: non aspettare indefinitamente né inventare risultati).
- **Verifica byte-identici non eseguita.**
- Storage-explorer URL di riferimento (probabilmente non ancora indicizzato, dato `finalized:false`): https://storagescan-galileo.0g.ai/file?root=0x2bd3d835b4b8b681949495646ef5703002ac6f1a0df25be28c176d48541994c4

**Rischio demo critico (follow-up richiesto per chi possiede `apps/web`):** qualunque flusso applicativo che chiama `uploadEncrypted()` in modo sincrono/bloccante (es. dentro una request HTTP) rischia di restare appeso per **20+ minuti** su rete reale, con nessun timeout interno lato SDK. Raccomandazione: disaccoppiare l'upload da request/response (fire-and-forget + job/poll separato con timeout esplicito lato app), non affidarsi al ritorno sincrono di `uploadEncrypted()` per l'esperienza utente in demo dal vivo.

### C. Spike inferenza — round trip reale: SUCCESSO al primo tentativo

Script throwaway ha usato `apps/web/src/lib/gpx/parse.ts` per parsare una fixture GPX reale (`scripts/fixtures/real/20260722-104118-Running-22-7-2026-11-41-A0DDBE46.gpx` → 9.969 km, 3968s, pace medio 398 sec/km, 9 split, HR assente), costruito i messaggi con `buildReportMessages()` per un profilo `drill_sergeant` (con 2 run precedenti sintetiche di contesto per il confronto), e chiamato `completeJson(ReportSchema, messages, retries=2)` dal servizio reale `apps/web/src/lib/inference` (nessuna modifica al codice; `x_0g_trace`/billing catturati intercettando `fetch` dall'esterno, dato che `CoachCompletion` non li espone).

- **JSON valido al primo tentativo** (`attempts=1`, nessun retry necessario).
- Modello: `glm-5.2` (via `router`), latenza totale **19465 ms**.
- Token: `prompt_tokens=483`, `completion_tokens=1274` (di cui `reasoning_tokens=789`), `total_tokens=1757`. `finish_reason: "stop"` (non troncato).
- `x_0g_trace`: `provider=0x7DCFe6AEa70350C2090041524c9B4A9262DCe87D`, `request_id=13eed4ff-2b82-4418-b241-392708839536`, `billing={input_cost:"2516430000000000", output_cost:"22154860000000000", total_cost:"24671290000000000"}` (wei-like unit, `total_cost` ≈ 0.02467129 in quella unità).
- **Nessun follow-up richiesto per `max_tokens`**: `routerComplete` non invia `max_tokens` e, su questo prompt reale (report completo con confronto storico), il budget di default del router è stato sufficiente — `finish_reason=stop`, contenuto completo ricevuto, JSON estratto e validato al primo colpo. Resta un rischio residuo teorico su prompt molto più lunghi/complessi (non osservato in questa run), ma non è un blocco reale osservato.

### Stato finale aggiornato

- Part A (deploy + sanity on-chain): **completo**, tutte le asserzioni passate.
- Part B (storage round trip reale): **bloccato sulla finalità di rete** dopo ~24 minuti di attesa reale — non un bug del nostro codice, comportamento genuino della rete Galileo/SDK osservato e riconfermato con chiamata diretta. Nessun dato inventato.
- Part C (inferenza reale): **completo**, JSON valido al primo tentativo, tracciabilità di pagamento (`x_0g_trace`) catturata.

## RunEvents — eventi permissionless con claim co-firmato (Piano B, Task 1)

**Data:** 2026-07-25
**Contesto:** `contracts/contracts/RunEvents.sol` implementa eventi creabili da chiunque (`createEvent`) e claim gated da World ID: il contratto non verifica la proof on-chain (nessun `WorldIDRouter` su 0G), quindi si fida solo di una firma del `backend` (= treasury) prodotta dopo un cloud-verify server-side. TDD seguito: test scritto per primo, RED confermato (`HH700: Artifact for contract "RunEvents" not found`), poi implementazione, GREEN 4/4, `npx hardhat test` completo 6/6 (i 2 test preesistenti di `OrunAgentNFT`/`CoachRegistry` restano verdi, nessuna regressione).

### Digest co-firmato (deve essere byte-identico Solidity ↔ backend)

Solidity (`RunEvents.claim`):
```solidity
bytes32 digest = keccak256(abi.encodePacked(eventId, msg.sender, nullifierHash));
require(MessageHashUtils.toEthSignedMessageHash(digest).recover(backendSig) == backend, "bad signature");
```

Backend/off-chain (identico, da usare in Task 2 per l'API `/api/events/:id/claim`):
```ts
const digest = ethers.solidityPackedKeccak256(
  ["uint256", "address", "bytes32"], [eventId, claimant, nullifierHash],
);
const backendSig = await treasuryWallet.signMessage(ethers.getBytes(digest));
```

### Scelta sul deploy: script dedicato invece del `deploy.ts` completo

`contracts/scripts/deploy.ts` è stato esteso per deployare anche `RunEvents(deployer.address)` (per coerenza futura e deploy completi da zero), ma il deploy reale su Galileo per questo task è stato eseguito con uno script separato, `contracts/scripts/deployRunEvents.ts`, che deploya **solo** `RunEvents`. Motivo: `deploy.ts` completo avrebbe ridispiegato anche `OrunAgentNFT` e `CoachRegistry`, già live in produzione — `CoachRegistry` supporta oggi un coach reale a `tokenId 3`; ridispiegarlo lo avrebbe orfanizzato. Gli indirizzi esistenti in `.env` (`AGENT_NFT_ADDRESS`, `COACH_REGISTRY_ADDRESS`) **non sono stati toccati**; è stato aggiunto solo `RUN_EVENTS_ADDRESS`.

### Deploy (rete `zgTestnet`, chainId 16602)

| Contratto | Indirizzo | Explorer |
|---|---|---|
| `RunEvents` (`RUN_EVENTS_ADDRESS`) | `0x1D66dd7C7b3f4228f7816Eb266fDCaeF49Cd89bE` | https://chainscan-galileo.0g.ai/address/0x1D66dd7C7b3f4228f7816Eb266fDCaeF49Cd89bE |

- Deploy tx: `0xce5f40e6d1f858259a506280427badcafe518ed7402671fe68acec3fbfb4e0db` (deployer/backend `0x7CAd48f536fC2d23dEa4756d6C601f9C065B6877`, gasUsed 864691, status 1) — https://chainscan-galileo.0g.ai/tx/0xce5f40e6d1f858259a506280427badcafe518ed7402671fe68acec3fbfb4e0db
- `eth_getCode` confermato non vuoto post-deploy (bytecode length 7302 hex chars, prefix `0x60808060`), tx receipt letto direttamente via `eth_getTransactionReceipt` (block 45876341, status 1).

### Prova reale del round-trip firma (Solidity ↔ backend), non solo mock

Script throwaway in `/tmp` (mai committato), eseguito con la sola treasury key (che coincide col `backend` del contratto, quindi funge sia da creator che da claimant qui):

1. `createEvent("Real claim round-trip test", now-60, now+3600, "ipfs://real-test")` → tx `0x3fafabc6873f9d000e38728232810afcbe954994d3988efd03222afa917a1b64` (status 1), `eventId = 1`.
2. Nullifier `keccak256("real-claim-nullifier-<timestamp>")`, digest calcolato lato script con `ethers.solidityPackedKeccak256(["uint256","address","bytes32"], [eventId, claimant, nullifierHash])`, firmato con `treasury.signMessage(ethers.getBytes(digest))` — esattamente la formula del test e del `sign()` che il backend userà in Task 2.
3. `claim(eventId, nullifierHash, backendSig)` → tx `0x6319915f23eaa4cab1c66641002fdde7190df7518dd1170f0ad2f7e7faa8854a` (status 1).
4. Verifica post-tx: `hasClaimed(1, treasury) == true`, `claimantsOf(1) == [treasury.address]`.

**Esito: SUCCESSO.** Nessun revert `"bad signature"` — il digest Solidity e quello backend combaciano byte-per-byte contro il contratto realmente deployato, non solo nei mock del test Hardhat locale.

## ERC-8004 IdentityRegistry — registrazione dell'agent coach (Piano B, Task 4)

**Data:** 2026-07-25
**Contesto:** ogni coach mintato viene registrato anche sul registry ERC-8004 IdentityRegistry, già deployato su Galileo (nessun contratto nostro). Il bando 0G parla esplicitamente di "Agentic ID" ed è ERC-8004-compatible: questo task copre quel deliverable a costo quasi nullo.

### Fonte dell'ABI — NON indovinato

Un ABI sbagliato fallisce solo a runtime on-chain, quindi l'interfaccia è stata stabilita PRIMA di scrivere codice, con tre fonti indipendenti:

1. **Reference implementation** clonata shallow in `/tmp` (mai committata): `github.com/erc-8004/erc-8004-contracts` (commit `68fc676`, "Merge pull request #83 from Wilbert957/feat/add-0g-mainnet"). File rilevanti: `contracts/IdentityRegistryUpgradeable.sol`, `abis/IdentityRegistry.json`.
2. Il `README.md` di quel repo elenca esplicitamente una sezione **"0G Galileo Testnet"** con gli stessi indirizzi già forniti nel piano — conferma indipendente che questo è il deploy giusto:
   - IdentityRegistry `0x8004A818BFB912233c491871b3d84c89A494BD9e`
   - ReputationRegistry `0x8004B663056A597Dffe9eCcC1965A193B7388713`
3. **Cross-check live** contro il bytecode realmente deployato su Galileo, in sola lettura (`eth_call`, nessun gas speso), da uno script throwaway in `/tmp`:
   - `eth_getCode` non vuoto su entrambi gli indirizzi (262 caratteri hex — pattern da proxy UUPS, coerente con `IdentityRegistryUpgradeable`).
   - `getVersion()` → `"2.0.0"` — combacia col sorgente.
   - `name()` → `"AgentIdentity"`, `symbol()` → `"AGENT"` — combaciano col sorgente ERC-721.
   - `register(agentURI, metadata).staticCall({from: treasury})` → ha restituito `agentId = 148` **senza revert**, confermando che il selettore chiamato da questo file è esattamente quello implementato dal bytecode deployato (non solo dal sorgente su GitHub).

### Firma esatta usata

```solidity
struct MetadataEntry { string metadataKey; bytes metadataValue; }
function register(string memory agentURI, MetadataEntry[] memory metadata) external returns (uint256 agentId);
event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
```

Implementata in `apps/web/src/lib/erc8004/register.ts` come:

```ts
const IDENTITY_REGISTRY_ABI = [
  "function register(string agentURI, tuple(string metadataKey, bytes metadataValue)[] metadata) returns (uint256 agentId)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
];
export async function registerAgent(tokenId: string, agentUri: string): Promise<{agentId:string;txHash:string}|{error:string}>
```

`registerAgent` non lancia mai (stessa disciplina di `lib/zerog/storage.ts`) e non è mai sul path della request di mint: parte in background da `apps/web/src/app/api/coach/mint/route.ts`, nella stessa lane fire-and-forget dell'upload Storage, dopo che il mint on-chain è già confermato. Il `tokenId` del coach (da `OrunAgentNFT`, contratto separato — vedi `lib/zerog/contracts.ts`) viene scritto come metadata **on-chain** (`"0run.tokenId"`) tramite l'overload a 3 argomenti, così le due identità sono collegabili on-chain e non solo per convenzione nell'URL. `agentId` è persistito su `coaches.agent_id` (colonna additiva nullable).

### Registrazione reale su Galileo — non solo mock

Script throwaway in `/tmp` (mai committato) ha importato direttamente `apps/web/src/lib/erc8004/register.ts` (nessuna modifica al file) e chiamato `registerAgent("3", "https://0run.fun/coach/3")` con la sola treasury key (`0x7CAd48f536fC2d23dEa4756d6C601f9C065B6877`).

- Tx: [`0x8b571001e567be0bb27c8650fc819b3fcb1e5dea54f9ed1057c634fa6fde9c40`](https://chainscan-galileo.0g.ai/tx/0x8b571001e567be0bb27c8650fc819b3fcb1e5dea54f9ed1057c634fa6fde9c40) (status 1, block 45877805, gasUsed 162727).
- **`agentId = 148`**.
- Verifica di lettura post-tx, con chiamate `eth_call` dirette e indipendenti (non solo il valore di ritorno della funzione appena chiamata):
  - `ownerOf(148)` == treasury ✓
  - `tokenURI(148)` == `"https://0run.fun/coach/3"` ✓ (l'URI passato è stato scritto correttamente)
  - `getMetadata(148, "0run.tokenId")` decodifica UTF-8 a `"3"` ✓ (il collegamento on-chain tra le due identità funziona)

**Esito: SUCCESSO.** Nessun revert, nessuna ABI indovinata — l'interfaccia usata è stata confermata contro il sorgente, contro il README del deploy 0G, e contro il bytecode realmente in esecuzione su Galileo prima ancora di scrivere `register.ts`.
