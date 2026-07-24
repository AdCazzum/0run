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
