"use client";
import { http } from "wagmi";
import { bsc, bscTestnet } from "wagmi/chains";
import { createConfig } from "@privy-io/wagmi";
import { bscFork, localMocks } from "@parallax/sdk";

/**
 * External wallets only. The connector list comes from Privy (see lib/privy.ts), which covers injected wallets,
 * Binance Wallet, OKX, Coinbase and WalletConnect for anything on a phone. This config carries the chains and
 * their transports; wagmi's own hooks work unchanged because @privy-io/wagmi keeps the two in step.
 */
export const wagmiConfig = createConfig({
  chains: [bscTestnet, bsc, bscFork, localMocks],
  transports: {
    [bsc.id]: http("https://bsc-dataseed.binance.org"),
    [bscTestnet.id]: http("https://bsc-testnet-rpc.publicnode.com"),
    [bscFork.id]: http("http://127.0.0.1:8547"),
    [localMocks.id]: http("http://127.0.0.1:8548"),
  },
  ssr: true,
});
