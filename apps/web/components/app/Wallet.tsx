"use client";
/*
 * Connect and account UI on Privy, external wallets only.
 *
 * Privy owns the picker, which is why this file no longer enumerates connectors: one button opens it, and it
 * covers injected wallets, OKX, Coinbase and WalletConnect for anything on a phone. No email,
 * no social, no embedded key: the user brings a wallet and signs every transaction themselves.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useAccount, useBalance, useSwitchChain } from "wagmi";
import { useNetwork } from "@/lib/network";
import { CHAINS, chainIdToNetwork } from "@parallax-hood/sdk";
import { NETWORKS, type NetworkId, explorerAddr } from "@/lib/config";
import { short } from "@/lib/format";
import { Ic } from "./icons";

export function useWalletState() {
  const { address, chainId: walletChain, isConnected } = useAccount();
  const { chainId } = useNetwork();
  return { address, isConnected, walletChain, wrongChain: isConnected && walletChain !== chainId, targetChain: chainId };
}

/** Connect button. The wallet list, the QR code and the session all belong to Privy. */
export function ConnectMenu({ className = "btn btn-primary", label = "Connect wallet" }: { className?: string; label?: string }) {
  const { ready, authenticated, login } = usePrivy();
  return (
    <button className={className} onClick={() => login()} disabled={!ready || authenticated} type="button">
      {!ready ? "Loading…" : authenticated ? "Check your wallet…" : label}
    </button>
  );
}

/**
 * Keeps wagmi pointed at the wallet Privy connected. Every page reads `useAccount`, so without this a fresh
 * login would authenticate with Privy and leave wagmi with no account.
 */
function useSyncedWallet() {
  const { wallets } = useWallets();
  const { setActiveWallet } = useSetActiveWallet();
  const { address } = useAccount();
  const first = wallets[0];
  useEffect(() => {
    if (first && !address) void setActiveWallet(first);
  }, [first, address, setActiveWallet]);
}

const declined = (e: unknown) => (e as { code?: number })?.code === 4001 || /user rejected|user denied|rejected the request/i.test((e as Error)?.message ?? "");

/**
 * Moves the connected wallet to the app's network. A wallet that has never seen Robinhood Chain cannot switch
 * to it, it has to be given the network first, so a failed switch is retried straight on the wallet's provider
 * and, when the chain is unknown there, followed by a request to add it (name, RPC, explorer, from the SDK's
 * chain definition). It is asked once by itself when a wallet connects on the wrong network; after that, and
 * after a refusal, only when the button is pressed.
 */
function useChainSwitch() {
  const { address, wrongChain, targetChain } = useWalletState();
  const { wallets } = useWallets();
  const { switchChainAsync } = useSwitchChain();
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const asked = useRef<string | null>(null);

  const run = useCallback(async () => {
    setState({ busy: true, error: null });
    try {
      try {
        await switchChainAsync({ chainId: targetChain });
      } catch (first) {
        if (declined(first)) throw first;
        const wallet = wallets.find((w) => w.address.toLowerCase() === address?.toLowerCase()) ?? wallets[0];
        if (!wallet) throw first;
        const provider = await wallet.getEthereumProvider();
        const chain = CHAINS[chainIdToNetwork(targetChain)];
        const chainId = `0x${targetChain.toString(16)}`;
        try {
          await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
        } catch (second) {
          if (declined(second)) throw second;
          const explorer = chain.blockExplorers?.default.url;
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [{ chainId, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: [...chain.rpcUrls.default.http], blockExplorerUrls: explorer ? [explorer] : undefined }],
          });
        }
      }
      setState({ busy: false, error: null });
    } catch (e) {
      setState({ busy: false, error: declined(e) ? "The switch was declined in the wallet." : `The wallet could not switch: ${((e as Error).message ?? "unknown error").split("\n")[0]!.slice(0, 160)}` });
    }
  }, [switchChainAsync, targetChain, wallets, address]);

  useEffect(() => {
    const key = `${address}:${targetChain}`;
    if (!wrongChain || !address || asked.current === key) return;
    asked.current = key;
    void run();
  }, [wrongChain, address, targetChain, run]);

  return { ...state, run };
}

/** Toolbar account row: connect, or address + balance + a one-press network switch + disconnect. */
export function WalletRow() {
  useSyncedWallet();
  const { address, isConnected, wrongChain, targetChain } = useWalletState();
  const { logout } = usePrivy();
  const chainSwitch = useChainSwitch();
  const bal = useBalance({ address, chainId: targetChain, query: { enabled: Boolean(address) } });
  const [open, setOpen] = useState(false);
  if (!isConnected || !address) return <ConnectMenu className="user-row justify-center" />;
  const net = NETWORKS[targetChain as NetworkId];
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {wrongChain && (
          <button className="net-switch" onClick={() => void chainSwitch.run()} disabled={chainSwitch.busy} type="button"
            title={chainSwitch.error ?? `The wallet is on another network. This asks it to switch to ${net?.name ?? targetChain}, adding the network first if the wallet does not know it.`}>
            <span className="dot dot-warn" style={{ marginRight: 0 }} />
            {/* the network is named in the chip at the start of the toolbar, so the button stays short */}
            {chainSwitch.busy ? "Check your wallet…" : "Switch network"}
          </button>
        )}
        <button className="user-row" onClick={() => setOpen((v) => !v)} type="button">
          <span className="user-avatar" />
          <span className="flex-1 min-w-0 text-left">
            <span className="block body-md font-medium truncate">{short(address)}</span>
            <span className="block body-xs muted truncate">{bal.data ? `${Number(bal.data.formatted).toFixed(3)} ${bal.data.symbol}` : net?.name}</span>
          </span>
          <span className="muted"><Ic.chevron /></span>
        </button>
      </div>
      {wrongChain && chainSwitch.error && <span className="body-xs text-right" style={{ color: "var(--warn)" }}>{chainSwitch.error}</span>}
      {open && (
        <div className="panel p-2 flex flex-col gap-0.5">
          {explorerAddr(targetChain, address) && (
            <a className="nav-item" href={explorerAddr(targetChain, address)!} target="_blank" rel="noreferrer"><Ic.share />View on explorer</a>
          )}
          <button className="nav-item w-full" onClick={() => { navigator.clipboard?.writeText(address); setOpen(false); }} type="button"><Ic.file />Copy address</button>
          <button className="nav-item w-full" onClick={() => { void logout(); setOpen(false); }} type="button"><Ic.x />Disconnect</button>
        </div>
      )}
    </div>
  );
}
