/**
 * Curated index products. A unit is a fixed number of underlying SHARES per stock — not a dollar amount — so a
 * unit's composition never drifts with price and the vault can prove backing without an oracle.
 *
 * Weights are chosen here, in the open, and turned into shares-per-unit at generation time from the catalogue
 * price. Nothing about a stock's inclusion is automated: each index states why it holds what it holds.
 */
export type IndexDef = {
  symbol: string;
  name: string;
  /** What this index is for, in one sentence a buyer can check. */
  thesis: string;
  /** Approximate dollar value of one unit at creation, used to turn weights into share counts. */
  unitValueUsd: number;
  constituents: { ticker: string; weightBps: number; why: string }[];
};

export const INDICES: IndexDef[] = [
  {
    symbol: "pxMAG7",
    name: "Parallax Magnificent 7",
    thesis: "The seven US megacaps that dominate index returns, equal-weighted so no single name decides the unit.",
    unitValueUsd: 100,
    constituents: [
      { ticker: "NVDA", weightBps: 1429, why: "AI compute; the largest single driver of the group's earnings revisions" },
      { ticker: "AAPL", weightBps: 1429, why: "Hardware and services cash flows; Ondo is the only issuer listing it today" },
      { ticker: "MSFT", weightBps: 1429, why: "Enterprise software plus the Azure AI build-out" },
      { ticker: "AMZN", weightBps: 1428, why: "Retail plus AWS; Ondo-only on BSC at the moment" },
      { ticker: "GOOGL", weightBps: 1429, why: "Search economics funding a full-stack AI effort" },
      { ticker: "META", weightBps: 1428, why: "Advertising cash flows financing compute" },
      { ticker: "TSLA", weightBps: 1428, why: "The group's highest-variance name; kept at equal weight deliberately" },
    ],
  },
  {
    symbol: "pxAI",
    name: "Parallax AI Infrastructure",
    thesis: "The picks and shovels of AI compute: silicon, networking, memory, foundry and rented GPUs, not the model labs.",
    unitValueUsd: 100,
    constituents: [
      { ticker: "NVDA", weightBps: 2500, why: "The accelerator standard; deliberately the largest weight" },
      { ticker: "AMD", weightBps: 1500, why: "The credible second source for training and inference silicon" },
      { ticker: "AVGO", weightBps: 1500, why: "Custom accelerators and the networking silicon behind them" },
      { ticker: "TSM", weightBps: 1500, why: "Every one of the above is fabricated here" },
      { ticker: "MRVL", weightBps: 1000, why: "Optical and custom silicon for data-centre interconnect" },
      { ticker: "MU", weightBps: 1000, why: "High-bandwidth memory is the current binding constraint" },
      { ticker: "CRWV", weightBps: 1000, why: "GPU capacity rented by the hour; the demand side of the same trade" },
    ],
  },
  {
    symbol: "pxNEW",
    name: "Parallax Private & Newly Public",
    thesis: "Exposure that is hard to get in a normal brokerage account: a pre-IPO name plus recent listings, tokenized.",
    unitValueUsd: 100,
    constituents: [
      { ticker: "SPCX", weightBps: 2500, why: "SpaceX — private, and the reason tokenization is interesting at all" },
      { ticker: "CRCL", weightBps: 1500, why: "Circle; stablecoin issuance economics" },
      { ticker: "CRWV", weightBps: 1500, why: "CoreWeave; the 2025 AI-infrastructure listing" },
      { ticker: "COIN", weightBps: 1500, why: "Coinbase; the listed proxy for crypto market structure" },
      { ticker: "HOOD", weightBps: 1500, why: "Robinhood; retail brokerage, itself a tokenized-equity issuer" },
      { ticker: "PLTR", weightBps: 1000, why: "Palantir; government and enterprise AI deployment" },
      { ticker: "NBIS", weightBps: 500, why: "Nebius; European GPU capacity, the smallest and least liquid holding" },
    ],
  },
];

/** Shares per unit for one constituent: (unit value × weight) ÷ price, as a 1e18 fixed-point share count. */
export function unitSharesFor(unitValueUsd: number, weightBps: number, priceUsd: number): bigint {
  if (priceUsd <= 0) throw new Error("no catalogue price for a constituent");
  const dollars = (unitValueUsd * weightBps) / 10_000;
  return BigInt(Math.round((dollars / priceUsd) * 1e18));
}
