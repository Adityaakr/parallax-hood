"use client";
import { http } from "wagmi";
import { createConfig } from "@privy-io/wagmi";
import { robinhood, robinhoodTestnet, robinhoodFork, localMocks } from "@parallax-hood/sdk";

/**
 * External wallets only. The connector list comes from Privy (see lib/privy.ts), which covers injected wallets,
 * OKX, Coinbase and WalletConnect for anything on a phone. This config carries the four chains and their
 * transports; wagmi's own hooks work unchanged because @privy-io/wagmi keeps the two in step.
 */
export const wagmiConfig = createConfig({
  chains: [robinhood, robinhoodTestnet, robinhoodFork, localMocks],
  transports: {
    [robinhood.id]: http("https://rpc.mainnet.chain.robinhood.com"),
    [robinhoodTestnet.id]: http("https://rpc.testnet.chain.robinhood.com"),
    [robinhoodFork.id]: http("http://127.0.0.1:8647"),
    [localMocks.id]: http("http://127.0.0.1:8648"),
  },
  ssr: true,
});
