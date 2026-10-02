import { type Address, type Chain, defineChain } from "viem";

/*
 * Robinhood Chain: an Arbitrum Orbit L2 on Ethereum, ETH for gas. Chain ids, RPCs and explorers are from
 * https://docs.robinhood.com/chain/ ("Connecting to Robinhood Chain", "Add network to your wallet") and each was
 * checked with `cast chain-id`; docs/addresses.md records the source and the check next to every address here.
 */
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address; // code present on 4663 and 46630

export const robinhood: Chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
  contracts: { multicall3: { address: MULTICALL3 } },
});

export const robinhoodTestnet: Chain = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Explorer", url: "https://explorer.testnet.chain.robinhood.com" } },
  contracts: { multicall3: { address: MULTICALL3 } },
  testnet: true,
});

/** Local anvil fork of Robinhood Chain mainnet (`pnpm fork:up`), chain id 31337 on port 8647. */
export const robinhoodFork: Chain = defineChain({
  id: 31337,
  name: "Robinhood Chain (local fork)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8647"] } },
  contracts: { multicall3: { address: MULTICALL3 } },
  testnet: true,
});

/** Plain local anvil with mocks (`pnpm mocks:up`), chain id 1337 on port 8648. */
export const localMocks: Chain = defineChain({
  id: 1337,
  name: "Local mocks",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8648"] } },
  testnet: true,
});

export type NetworkKey = "robinhood" | "robinhoodTestnet" | "fork" | "mocks";
export const CHAINS: Record<NetworkKey, Chain> = { robinhood, robinhoodTestnet, fork: robinhoodFork, mocks: localMocks };
export const chainIdToNetwork = (id: number): NetworkKey =>
  id === 4663 ? "robinhood" : id === 46630 ? "robinhoodTestnet" : id === 1337 ? "mocks" : "fork";

/** Shown on every screen and in every tool response, so nobody mistakes a test network for the real one. */
export const NETWORK_LABEL: Record<NetworkKey, { name: string; kind: "mainnet" | "testnet" | "local" }> = {
  robinhood: { name: "Robinhood Chain", kind: "mainnet" },
  robinhoodTestnet: { name: "Robinhood Chain Testnet", kind: "testnet" },
  fork: { name: "Local fork of Robinhood Chain", kind: "local" },
  mocks: { name: "Local mocks", kind: "local" },
};

/**
 * USDG, the quote and settlement asset. Six decimals on Robinhood Chain (`decimals()` read on-chain), unlike the
 * 1e18 scale every share, ratio and USD price uses, so amounts of it are converted explicitly, never assumed.
 */
export const USDG_DECIMALS = 6;
export const USDG_UNIT = 10n ** 6n;
/** Multiply a raw USDG amount by this to get 1e18-scaled USD (USDG is taken at $1, as the contracts do). */
export const USDG_TO_WAD = 10n ** 12n;

/** Robinhood Chain mainnet addresses (source and on-chain check per address in docs/addresses.md). Valid on the fork too. */
export const ROBINHOOD_ADDRESSES = {
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address,
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as Address,
  uniswapV3Factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA" as Address,
  uniswapQuoterV2: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7" as Address,
  uniswapSwapRouter02: "0xCaf681a66D020601342297493863E78C959E5cb2" as Address,
} as const;

/** Uniswap v3 fee tiers enabled on the Robinhood Chain factory. */
export const UNISWAP_V3_FEES = [100, 500, 3000, 10000] as const;
export type UniswapFee = (typeof UNISWAP_V3_FEES)[number];
