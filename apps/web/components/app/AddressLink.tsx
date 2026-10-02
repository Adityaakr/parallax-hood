"use client";
/*
 * An address, in full and clickable.
 *
 * Everything this product claims is checkable on chain, so a half-written address is a half-kept promise: the
 * whole thing is printed, it opens the explorer for the network you are on, and a click on the copy mark puts
 * it on the clipboard. Where a row is too narrow for 42 characters the middle is elided visually by the browser
 * (`text-overflow`), and the full value is still what is copied, linked and read out.
 */
import { useState } from "react";
import { useNetwork } from "@/lib/network";
import { explorerAddr, explorerTx } from "@/lib/config";

export function AddressLink({ value, kind = "address", label, truncate = false }: {
  value: string | null | undefined;
  kind?: "address" | "tx";
  /** shown instead of the address itself, with the address kept in the title and the copy */
  label?: string;
  /** let a narrow cell elide the tail; the value copied and linked is still the whole address */
  truncate?: boolean;
}) {
  const { chainId } = useNetwork();
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="muted">n/a</span>;
  const href = kind === "tx" ? explorerTx(chainId, value) : explorerAddr(chainId, value);
  const body = label ?? value;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked: the address is on screen in full anyway */
    }
  };
  return (
    <span className="addr" title={value}>
      {href ? (
        <a className="addr-link mono" href={href} target="_blank" rel="noreferrer" data-truncate={truncate || undefined}>{body}</a>
      ) : (
        <span className="mono" data-truncate={truncate || undefined}>{body}</span>
      )}
      <button className="addr-copy" onClick={copy} aria-label={copied ? "Copied" : `Copy ${value}`} title={copied ? "Copied" : "Copy"}>
        {copied ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l4 4L19 7" /></svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>
        )}
      </button>
    </span>
  );
}
