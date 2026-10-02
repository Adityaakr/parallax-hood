"use client";
/*
 * Eligibility: who may use the product, asked once and stated always.
 *
 * Robinhood Stock Tokens are not offered to U.S. persons or in a list of restricted jurisdictions. Parallax does
 * not geolocate anyone, so the first visit to any product page asks for the confirmation the issuer's terms
 * require, and nothing behind the dialog can be used until it is given. The answer is kept in localStorage; the
 * one-line notice in the shell footer stays on every page either way.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

const KEY = "parallax-hood:eligibility";
export const ELIGIBILITY_NOTICE = "Not available to U.S. persons or in restricted jurisdictions. Not investment advice. Unaudited software.";

/** null while the saved answer is being read, so a returning visitor never sees the dialog flash. */
export function useEligibility() {
  const [confirmed, setConfirmed] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setConfirmed(localStorage.getItem(KEY) === "1");
    } catch {
      setConfirmed(false); // private window: ask, and ask again next time
    }
  }, []);
  const confirm = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* the confirmation still holds for this page view */
    }
    setConfirmed(true);
  };
  return { confirmed, confirm };
}

export function EligibilityDialog({ onConfirm }: { onConfirm: () => void }) {
  return (
    <div className="gate" role="dialog" aria-modal="true" aria-labelledby="gate-title" aria-describedby="gate-text">
      <div className="gate-card">
        <span className="eyebrow">Before you continue</span>
        <h2 id="gate-title" className="h4">Not available to U.S. persons</h2>
        <p id="gate-text" className="body-sm" style={{ lineHeight: 1.6 }}>
          Robinhood Stock Tokens are not registered under U.S. securities laws and may not be offered or sold in the
          United States or to U.S. persons. They are also restricted in other jurisdictions, including Canada, the
          United Kingdom and Switzerland, and to persons subject to sanctions. By continuing you confirm that you
          are not a U.S. person, that you are not located in a restricted jurisdiction, and that you are not using
          a VPN to hide your location.
        </p>
        <p className="body-xs muted">
          Source: Robinhood&apos;s own terms for{" "}
          <a className="link" href="https://docs.robinhood.com/chain/stock-tokens" target="_blank" rel="noreferrer">stock tokens</a> and its list of{" "}
          <a className="link" href="https://docs.robinhood.com/rhj/restricted-jurisdictions" target="_blank" rel="noreferrer">restricted jurisdictions</a>.
          Parallax is unaudited software and nothing here is investment advice.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <button className="btn btn-primary" onClick={onConfirm} type="button" autoFocus>I confirm, continue</button>
          <Link className="btn btn-secondary" href="/">Leave</Link>
        </div>
      </div>
    </div>
  );
}
