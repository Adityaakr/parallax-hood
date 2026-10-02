"use client";
import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useWalletClient, useSwitchChain } from "wagmi";
import { type Address, type Hex } from "viem";
import { Erc20Abi } from "@parallax-hood/sdk";
import { useNetwork } from "@/lib/network";
import { explorerTx } from "@/lib/config";
import { ConnectMenu } from "./app/Wallet";
import { Banner, A } from "./ui";

type Tx = { to: Address; data: Hex; value?: string; gas?: string };

/**
 * Approve (if needed) + send, with the first-transaction disclaimer, chain switch, and receipt link.
 * `approval` = { token, spender, amount } to check allowance before sending. `amount` is raw, in the token's own
 * decimals: 6 for USDG (the resolver's `fee.totalUsdgIn`, `maxUsdgIn`), 18 for a stock token being sold.
 */
export function TxButton({ tx, label, approval, approvalSymbol = "USDG", disabled, onSent, className = "btn btn-primary" }: { tx: Tx | null; label: string; approval?: { token: Address; spender: Address; amount: bigint }; approvalSymbol?: string; disabled?: boolean; onSent?: (hash: Hex) => void; className?: string }) {
  const { address, chain } = useAccount();
  const { chainId } = useNetwork();
  const { data: wallet } = useWalletClient();
  const pub = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const [state, setState] = useState<{ step: "idle" | "confirm" | "approving" | "sending" | "done" | "error"; hash?: Hex; error?: string }>({ step: "idle" });
  const [ack, setAck] = useState(false);
  useEffect(() => {
    try {
      setAck(localStorage.getItem("parallax-hood:ack") === "1");
    } catch {}
  }, []);

  const run = async () => {
    if (!wallet || !pub || !address || !tx) return;
    try {
      if (chain?.id !== chainId) await switchChainAsync({ chainId });
      if (approval) {
        const al = await pub.readContract({ address: approval.token, abi: Erc20Abi, functionName: "allowance", args: [address, approval.spender] });
        if (al < approval.amount) {
          setState({ step: "approving" });
          const h = await wallet.writeContract({ address: approval.token, abi: Erc20Abi, functionName: "approve", args: [approval.spender, approval.amount], chain: undefined });
          await pub.waitForTransactionReceipt({ hash: h });
        }
      }
      setState({ step: "sending" });
      const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n, gas: tx.gas ? BigInt(tx.gas) : undefined, chain: undefined });
      const rcpt = await pub.waitForTransactionReceipt({ hash });
      if (rcpt.status !== "success") throw new Error("transaction reverted on chain");
      setState({ step: "done", hash });
      onSent?.(hash);
    } catch (e) {
      setState({ step: "error", error: (e as Error).message.split("\n")[0]?.slice(0, 240) });
    }
  };

  const onClick = () => {
    if (!ack) {
      setState({ step: "confirm" });
      return;
    }
    void run();
  };

  if (!address) return <ConnectMenu className={className} label="Connect wallet to sign" />;
  return (
    <div className="space-y-2">
      {state.step === "confirm" && (
        <Banner kind="warn">
          <div className="font-medium mb-1">Before your first transaction</div>
          <p className="text-xs leading-relaxed">
            Parallax is unaudited software. Not investment advice. Robinhood Stock Tokens are not available to U.S. persons or in restricted jurisdictions; you are responsible for your eligibility.
            Transactions are simulated before they are shown to you, but execution on chain can still fail or differ.
          </p>
          <button
            className="btn btn-primary mt-2"
            onClick={() => {
              try {
                localStorage.setItem("parallax-hood:ack", "1");
              } catch {}
              setAck(true);
              setState({ step: "idle" });
              void run();
            }}
          >
            I understand, continue
          </button>
        </Banner>
      )}
      <button className={className} disabled={disabled || !tx || state.step === "approving" || state.step === "sending"} onClick={onClick}>
        {state.step === "approving" ? `Approving ${approvalSymbol}…` : state.step === "sending" ? "Confirm in wallet…" : label}
      </button>
      {state.step === "done" && state.hash && (
        <Banner kind="good">
          Sent: <span className="num">{state.hash.slice(0, 18)}…</span> {explorerTx(chainId, state.hash) ? <A href={explorerTx(chainId, state.hash)!}>view</A> : null} · <A href={`/receipts?tx=${state.hash}`}>receipt</A>
        </Banner>
      )}
      {state.step === "error" && <Banner kind="bad">{state.error}</Banner>}
    </div>
  );
}
