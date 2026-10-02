"use client";
import { useState } from "react";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useApi, useApiPost, type Health } from "@/lib/api";
import { fmt, fmtUsdg } from "@/lib/format";
import { Ic } from "./icons";

/**
 * "Get test USDG" from the resolver's faucet, shown only where the resolver advertises one (`/health.faucet`):
 * the local chains and the testnet, never mainnet. The reply carries the wallet's balances after the grant,
 * USDG as a raw 6-decimal amount and ETH in wei, and that is what is printed.
 */
export function Faucet() {
  const { address } = useAccount();
  const qc = useQueryClient();
  const health = useApi<Health>("/health");
  const faucet = useApiPost<{ address: string }, { address: string; eth: string; usdg: string; txHash: string }>("/faucet");
  const [msg, setMsg] = useState<string | null>(null);
  if (!health.data?.faucet) return null;
  return (
    <div className="flex flex-col gap-1">
      <button
        className="nav-item"
        disabled={!address || faucet.isPending}
        title={address ? "Sends mock USDG, and test ETH for gas, to the connected wallet" : "Connect a wallet first"}
        onClick={() => faucet.mutate({ address: address! }, { onSuccess: (r) => { setMsg(`Balance now ${fmtUsdg(r.usdg, 2)} test USDG, ${fmt(r.eth, 18, 4)} ETH`); qc.invalidateQueries(); }, onError: (e) => setMsg(e.message) })}
      >
        <Ic.plus />{faucet.isPending ? "Funding…" : "Get test USDG"}
      </button>
      {msg && <div className="body-xs muted px-3">{msg}</div>}
    </div>
  );
}
