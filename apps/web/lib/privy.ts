"use client";
/*
 * Privy, configured for external wallets only.
 *
 * Parallax never custodies anything, and the connect flow says so: the only login method is a wallet the user
 * already controls, and embedded-wallet creation is off, so Privy never mints a key on anyone's behalf. What it
 * adds over the bare connectors is reach — WalletConnect (so any mobile wallet can scan), Binance Wallet, OKX,
 * Coinbase and whatever the browser has injected — behind one button, and a session that survives a reload.
 *
 * The app id is a public client identifier; it is in the bundle either way, and the app's allowed domains are
 * what protect it. NEXT_PUBLIC_PRIVY_APP_ID overrides it per deployment.
 */
import type { PrivyClientConfig } from "@privy-io/react-auth";
import { bsc, bscTestnet } from "viem/chains";
import { bscFork, localMocks } from "@parallax/sdk";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "cmq7sn14a007r0cl8y19z4krd";

export const privyConfig: PrivyClientConfig = {
  loginMethods: ["wallet"],
  // no email, no social, no key created for anyone: the user brings the wallet
  embeddedWallets: { ethereum: { createOnLogin: "off" } },
  appearance: {
    theme: "light",
    accentColor: "#f24100",
    walletChainType: "ethereum-only",
    showWalletLoginFirst: true,
    landingHeader: "Connect a wallet",
    loginMessage: "Parallax routes and settles on BNB Chain. Nothing is custodied: you sign every transaction.",
    /* The QR is pinned to the top row. Privy shows about four rows and folds the rest into "Other wallets", so
       a browser carrying three extensions fills the screen with detected wallets and leaves anyone whose wallet
       is on their phone with nothing to scan. `wallet_connect_qr` is one row; plain `wallet_connect` expands
       into the whole WalletConnect registry and buries everything else. */
    walletList: ["wallet_connect_qr", "detected_ethereum_wallets", "binance", "metamask", "okx_wallet", "coinbase_wallet"],
  },
  defaultChain: bsc,
  supportedChains: [bsc, bscTestnet, bscFork, localMocks],
};
