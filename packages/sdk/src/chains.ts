import { type Address, type Chain, defineChain } from "viem";
import { bsc, bscTestnet } from "viem/chains";

export { bsc, bscTestnet };

/** Local anvil fork of BSC mainnet (`pnpm fork`), chain id 31337 on port 8547. */
export const bscFork: Chain = defineChain({
  id: 31337,
  name: "BSC (local fork)",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8547"] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
  testnet: true,
});

/** Plain local anvil with mocks (`pnpm mocks:up`), chain id 1337 on port 8548. */
export const localMocks: Chain = defineChain({
  id: 1337,
  name: "Local mocks",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8548"] } },
  testnet: true,
});

export type NetworkKey = "bsc" | "bscTestnet" | "fork" | "mocks";
export const CHAINS: Record<NetworkKey, Chain> = { bsc, bscTestnet, fork: bscFork, mocks: localMocks };
export const chainIdToNetwork = (id: number): NetworkKey =>
  id === 56 ? "bsc" : id === 97 ? "bscTestnet" : id === 1337 ? "mocks" : "fork";

/** Well-known BSC mainnet addresses (verified in docs/recon.md). Valid on the fork too. */
export const BSC_ADDRESSES = {
  usdt: "0x55d398326f99059fF775485246999027B3197955" as Address,
  pancakeSmartRouter: "0x13f4EA83D0bd40E75C8222255bc855a974568Dd4" as Address,
  pancakeV3SwapRouter: "0x1b81D678ffb9C0263b24A97847620C99d213eB14" as Address,
  pancakeQuoterV2: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997" as Address,
  pancakeV3Factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" as Address,
  chainlink: {
    NVDA: "0xea5c2Cbb5cD57daC24E26180b19a929F3E9699B8",
    AAPL: "0xb7Ed5bE7977d61E83534230f3256C021e0fae0B6",
    MSFT: "0x5D209cE1fBABeAA8E6f9De4514A74FFB4b34560F",
    AMZN: "0x51d08ca89d3e8c12535BA8AEd33cDf2557ab5b2a",
    GOOGL: "0xeDA73F8acb669274B15A977Cb0cdA57a84F18c2a",
    META: "0xfc76E9445952A3C31369dFd26edfdfb9713DF5Bb",
    TSLA: "0xEEA2ae9c074E87596A85ABE698B2Afebc9B57893",
    SPY: "0xb24D1DeE5F9a3f761D286B56d2bC44CE1D02DF7e",
    QQQ: "0x9A41B56b2c24683E2f23BdE15c14BC7c4a58c3c4",
  } as Record<string, Address>,
} as const;

export const PANCAKE_V3_FEES = [100, 500, 2500, 10000] as const;
export type PancakeFee = (typeof PANCAKE_V3_FEES)[number];

/** Mag 7 representations on BSC mainnet, from Phase 0 recon (docs/recon.md §1). */
export const MAINNET_REPRESENTATIONS: ReadonlyArray<{
  ticker: string;
  platform: "ondo" | "bstock";
  symbol: string;
  token: Address;
  ratioSource: "KEEPER" | "ERC8056";
}> = [
  { ticker: "NVDA", platform: "bstock", symbol: "NVDAB", token: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436", ratioSource: "ERC8056" },
  { ticker: "AAPL", platform: "bstock", symbol: "AAPLB", token: "0x431a3BEE82E2ca41e49895CbECE5bB0F76A89b7A", ratioSource: "ERC8056" },
  { ticker: "MSFT", platform: "bstock", symbol: "MSFTB", token: "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0", ratioSource: "ERC8056" },
  { ticker: "AMZN", platform: "bstock", symbol: "AMZNB", token: "0x1a4b499833A79A09ad7Cf1D42D7DacF71e92eb00", ratioSource: "ERC8056" },
  { ticker: "GOOGL", platform: "bstock", symbol: "GOOGLB", token: "0x3F53De71c126BdaBAe20f9cD64848d317f6C3238", ratioSource: "ERC8056" },
  { ticker: "META", platform: "bstock", symbol: "METAB", token: "0x7425889FE94F9d693E8daefE88BCCed6AcFEf4c0", ratioSource: "ERC8056" },
  { ticker: "TSLA", platform: "bstock", symbol: "TSLAB", token: "0x5b1910eAaD6450E50f816082Aa078C41F10C292f", ratioSource: "ERC8056" },
  { ticker: "NVDA", platform: "ondo", symbol: "NVDAon", token: "0xA9eE28C80f960B889dFbd1902055218cBa016F75", ratioSource: "KEEPER" },
  { ticker: "AAPL", platform: "ondo", symbol: "AAPLon", token: "0x390a684EF9cADE28A7AD0DFa61AB1Eb3842618c4", ratioSource: "KEEPER" },
  { ticker: "MSFT", platform: "ondo", symbol: "MSFTon", token: "0x6Bfe75D1ad432050eA973C3A3DcD88F02e2444C3", ratioSource: "KEEPER" },
  { ticker: "AMZN", platform: "ondo", symbol: "AMZNon", token: "0x4553cFe1C09f37f38b12dC509F676964e392F8Fc", ratioSource: "KEEPER" },
  { ticker: "GOOGL", platform: "ondo", symbol: "GOOGLon", token: "0x091FC7778e6932d4009B087B191D1EE3bac5729A", ratioSource: "KEEPER" },
  { ticker: "META", platform: "ondo", symbol: "METAon", token: "0xD7dF5863A3e742F0c767768cDfcb63f09E0422f6", ratioSource: "KEEPER" },
  { ticker: "TSLA", platform: "ondo", symbol: "TSLAon", token: "0x2494b603319d4D9F9715c9f4496d9E0364B59d93", ratioSource: "KEEPER" },
];
