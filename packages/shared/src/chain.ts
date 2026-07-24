export const GALILEO = {
  chainId: 16602,
  name: "0G Galileo Testnet",
  rpcUrl: "https://evmrpc-testnet.0g.ai",
  indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
  explorer: "https://chainscan-galileo.0g.ai",
  storageExplorer: "https://storagescan-galileo.0g.ai",
  currency: { name: "0G", symbol: "0G", decimals: 18 },
} as const;
export const explorerTx = (h: string) => `${GALILEO.explorer}/tx/${h}`;
export const storageExplorerRoot = (r: string) => `${GALILEO.storageExplorer}/file?root=${r}`;
