"use client";
/*
 * Connect and account UI on Privy, external wallets only.
 *
 * Privy owns the picker, which is why this file no longer enumerates connectors: one button opens it, and it
 * covers injected wallets, OKX, Coinbase and WalletConnect for anything on a phone. No email,
 * no social, no embedded key: the user brings a wallet and signs every transaction themselves.
 */
import { useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { useAccount, useBalance, useSwitchChain } from "wagmi";
import { useNetwork } from "@/lib/network";
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

/** Sidebar account row: connect, or address + balance + network warning + disconnect. */
export function WalletRow() {
  useSyncedWallet();
  const { address, isConnected, wrongChain, targetChain } = useWalletState();
  const { logout } = usePrivy();
  const { switchChain, isPending: switching } = useSwitchChain();
  const bal = useBalance({ address, chainId: targetChain, query: { enabled: Boolean(address) } });
  const [open, setOpen] = useState(false);
  if (!isConnected || !address) return <ConnectMenu className="user-row justify-center" />;
  const net = NETWORKS[targetChain as NetworkId];
  return (
    <div className="flex flex-col gap-1">
      {wrongChain && (
        <button className="banner banner-warn text-left" onClick={() => switchChain({ chainId: targetChain })} type="button">
          {switching ? "Check your wallet…" : `Wallet is on another network. Switch to ${net?.name ?? targetChain}.`}
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
