"use client";
import { useState } from "react";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useApi, useApiPost, type Health } from "@/lib/api";
import { useNetwork } from "@/lib/network";
import { fmt } from "@/lib/format";
import { Ic } from "./icons";

/** "Get test funds" from the resolver's faucet, rendered wherever the resolver advertises one (fork, local mocks, BSC testnet). */
export function Faucet() {
  const { chainId } = useNetwork();
  const { address } = useAccount();
  const qc = useQueryClient();
  const health = useApi<Health>("/health");
  const faucet = useApiPost<{ address: string }, { usdt: string; bnb: string; txHash: string }>("/faucet");
  const [msg, setMsg] = useState<string | null>(null);
  if (!health.data?.faucet) return null;
  const grant = chainId === 97 ? "10,000 test USDT (+ a little tBNB for gas) on BSC testnet" : "1 BNB + 2,000 USDT on this local chain";
  return (
    <div className="flex flex-col gap-1">
      <button
        className="nav-item"
        disabled={!address || faucet.isPending}
        title={address ? grant : "Connect a wallet first"}
        onClick={() => faucet.mutate({ address: address! }, { onSuccess: (r) => { setMsg(`Funded: ${fmt(r.usdt, 18, 0)} USDT · ${fmt(r.bnb, 18, 2)} BNB`); qc.invalidateQueries(); }, onError: (e) => setMsg(e.message) })}
      >
        <Ic.plus />{faucet.isPending ? "Funding…" : "Get test funds"}
      </button>
      {msg && <div className="body-xs muted px-3">{msg}</div>}
    </div>
  );
}
