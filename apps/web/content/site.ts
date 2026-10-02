/*
 * Site-wide content for Parallax on Robinhood Chain. The layout, motion and every measurement stay the Syncrun
 * reconstruction's (see content/syncrun for the reference copy); only the words and links are ours. Every
 * figure traces to docs/addresses.md or contracts/script/config/robinhood.json. There are no usage, volume or
 * performance figures here because there are none to report: nothing is deployed on mainnet yet.
 */

export const REPO = "https://github.com/Adityaakr/parallax-hood";
const DOC = (file: string) => `${REPO}/blob/main/docs/${file}`;
export const DOCS = { addresses: DOC("addresses.md"), invariants: DOC("invariants.md"), threatModel: DOC("threat-model.md") };

export const NOT_AFFILIATED = "Parallax is an independent project and is not affiliated with or endorsed by Robinhood, Paxos, Chainlink or Uniswap.";

export const META = {
  title: "Parallax on Robinhood Chain",
  description: "A token is not a share. Parallax measures Robinhood stock tokens in underlying shares: USDG index vaults, agent mandates enforced on chain, and execution priced per share. On Robinhood Chain Testnet with mock tokens, and tested against a fork of mainnet; mainnet deployment is pending. Unaudited. Not available to U.S. persons.",
};

export const NAV = {
  logo: { src: "/parallax-icon.svg", alt: "Parallax", text: "Parallax", href: "/#Header" },
  items: [
    { label: "Home", href: "/#Header" },
    { label: "How it works", href: "/about" },
    { label: "Indices", href: "/plans" },
    { label: "Changelog", href: "/changelog" },
    { label: "Notes", href: "/blog" },
  ],
  cta: { label: "Open the app", href: "/baskets" },
};

/** The footer's CTA repeats the home hero on every page. */
export const CTA = {
  title: "Count the position in shares.",
  text: "Mint an index with USDG, buy a single stock, or give an agent a mandate it cannot exceed. On Robinhood Chain Testnet with mock tokens, and tested against a fork of mainnet; mainnet deployment is pending.",
  primary: { label: "View the indices", href: "/baskets" },
  secondary: { label: "Search a stock", href: "/stocks" },
};

export const FOOTER = {
  /* there is no mailing list: the form opens the repository, and the copy says so */
  newsletter: { title: "Follow the build", text: "There is no mailing list. This box opens the repository, where every change lands and where the mainnet deployment will be recorded when it happens.", placeholder: "Your Email", button: "Open", inputName: "Email" },
  columns: [
    { title: "Product", links: [["Search a stock", "/stocks"], ["Indices", "/baskets"], ["Portfolio", "/portfolio"], ["Activity", "/receipts"], ["Agents", "/mandates"], ["How it works", "/how-it-works"]] },
    { title: "Project", links: [["Notes", "/blog"], ["Changelog", "/changelog"], ["GitHub", REPO], ["Addresses", DOCS.addresses], ["Invariants", DOCS.invariants], ["Threat model", DOCS.threatModel]] },
    { title: "Legal", links: [["Eligibility", "/legals/terms-of-service#eligibility"], ["Terms of service", "/legals/terms-of-service"], ["Privacy policy", "/legals/privacy-policy"]] },
  ] as { title: string; links: [string, string][] }[],
  /* the reference's bottom row, carrying the notices every page has to show */
  bottom: {
    notice: `Not available to U.S. persons. Unaudited software; not investment advice. ${NOT_AFFILIATED}`,
    link: { label: "Eligibility", href: "/legals/terms-of-service#eligibility" },
  },
};

/**
 * The rail that held customer logos in the reference. Parallax has no customers or partners to show, so it
 * lists what the registry supports, as plain wordmarks: the seven stocks and the two indices.
 */
export const LOGOS = {
  caption: "[ Seven stocks, two indices ]",
  // The chain's own logo on Robin Neon, alone on its card as its brand guidelines ask, then each stock with its
  // company mark and each index with its token mark.
  items: [
    { src: "/brand/robinhood-chain-logo-black.svg", w: 198, h: 26, label: "", alt: "Robinhood Chain", tone: "neon" },
    ...["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA"].map((label) => ({ src: `/stocks/${label.toLowerCase()}.svg`, w: 34, h: 34, label })),
    { src: "/tokens/pxmag7.svg", w: 34, h: 34, label: "pxMAG7" },
    { src: "/tokens/pxai.svg", w: 34, h: 34, label: "pxAI" },
  ] as { src: string; w: number; h: number; label: string; alt?: string; tone?: "neon" }[],
};

export const FAQS = {
  tag: "FAQs",
  title: "Questions?",
  text: "What to know before trusting a contract with an order, including the answers that are not flattering.",
  cta: { title: "More questions?", text: "The repository has the rest.", button: { label: "Read the docs", href: `${REPO}#readme` } },
  items: [
    { q: "Is this live?", a: "Not on mainnet. The contracts are deployed on Robinhood Chain Testnet (chain id 46630), where the stock tokens, USDG and the venue are test stand-ins kept on mainnet's live prices, and have been run against a fork of Robinhood Chain mainnet (chain id 4663) with the real tokens, feeds and pools. The code is unaudited." },
    { q: "Why is a token not a share?", a: "A Robinhood stock token carries an on-chain multiplier, uiMultiplier() under ERC-8056. It grows with reinvested dividends and changes on splits, so the number of tokens you hold is not the number of shares you own. Parallax converts every quantity to underlying shares before it compares, bounds or records anything." },
    { q: "What does an index unit hold?", a: "A fixed number of underlying shares of each constituent, not a dollar weight that drifts with a manager. pxMAG7 holds the seven stocks at equal weight. pxAI holds NVDA at 40 % and MSFT, GOOGL and META at 20 % each. Each was sized to about 100 dollars a unit when configured. After every call the vault must hold at least units × sharesPerUnit of every constituent, or the call reverts." },
    { q: "How do I get out of an index?", a: "Redeem for USDG, or redeem in kind and receive the stock tokens themselves. In-kind redemption does not depend on any oracle, venue or pause that Parallax controls, and it carries no fee. It does depend on the issuer: a token that Robinhood has paused, or an address it has blocked, cannot move until the issuer lifts that." },
    { q: "What can an agent do with a mandate?", a: "Trade inside the limits the wallet owner set: a per-transaction cap and a daily cap in USDG, an expiry, an allowlist of stocks and vaults, and a maximum slippage against the Chainlink price. The agent trades through the mandate contract and can never receive the assets: output always goes to the owner. Revocation is one transaction and immediate. Agents connect through an MCP server with read tools and one write tool." },
    { q: "How is a trade priced?", a: "Quotes come from the chain: the Uniswap v3 factory and QuoterV2, across fee tiers and through WETH where that returns more. Each quote is scored in dollars per underlying share against the Chainlink reference. Slippage protection is denominated in shares (minShares), and the receipt on chain links to the scoring record." },
    { q: "Whom do I have to trust?", a: "An admin key, a single deployer key for now, registers tokens and sets limits. Robinhood, as issuer, can pause a token, block an address, burn, and upgrade the token contracts. Paxos can pause USDG or freeze an address. Chainlink stock feeds do not update over the weekend; a stale price blocks agent buys only, never an owner's own trade or exit." },
    { q: "Is this audited?", a: "No. There are 139 Foundry tests, including fuzz and handler-based invariant suites (backing, redeem in kind, monotone migration, mandate caps), plus a fork test against the real tokens, feeds and pools. That is not an audit. Vault supply is capped at launch." },
    { q: "What does it cost?", a: "A protocol fee of 0.5 % of USDG notional on buys, sells, mints and USDG redemptions. There is no fee on in-kind redemption. The contract hard-caps the fee at 1 %. You also pay network gas on your own transactions." },
    { q: "Who can use it?", a: `Not U.S. persons. The issuer states: "Stock Tokens are not registered under U.S. securities laws and may not be offered, sold, or delivered, directly or indirectly, in the United States or to, or for the account or benefit of, U.S. persons." Restrictions apply in other jurisdictions too; see the terms. ${NOT_AFFILIATED}` },
  ],
};

/**
 * The Plans frame: three cards. Two are the indices (names, symbols and constituents are the definitions in
 * contracts/script/config/robinhood.json; return, minimum and NAV are fetched live from the resolver and the
 * card says so when they are not available). The third slot, which held a pricing tier in the reference, is
 * the single-stock path, with the fee facts in place of live figures.
 */
export type IndexCard = { kind: "index"; symbol: string; name: string; thesis: string; tickers: string[] };
export type StocksCard = { kind: "stocks"; label: string; name: string; thesis: string; tickers: string[]; href: string; chip: string; figs: [string, string][]; note: string; go: string };
export const PLANS = {
  tag: "Indices",
  title: "Two indices, each a fixed basket of shares.",
  text: "A unit is a fixed number of underlying shares of each constituent. You deposit USDG, the vault buys every stock through Uniswap v3 in the same transaction, and you can redeem for USDG or in kind.",
  offline: "Live figures unavailable: the resolver is not reachable from this page right now.",
  cards: [
    { kind: "index", symbol: "pxMAG7", name: "Parallax Magnificent 7", thesis: "NVDA, AAPL, MSFT, AMZN, GOOGL, META and TSLA at equal weight, sized to about 100 dollars a unit when configured.", tickers: ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA"] },
    { kind: "index", symbol: "pxAI", name: "Parallax AI Compute", thesis: "NVDA at 40 % and MSFT, GOOGL and META at 20 % each, sized to about 100 dollars a unit when configured.", tickers: ["NVDA", "MSFT", "GOOGL", "META"] },
    { kind: "stocks", label: "7 stocks", name: "Single stocks", thesis: "Any of the seven on its own, quoted in dollars per underlying share and filled with a minimum in shares.", tickers: ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA"], href: "/stocks", chip: "router", figs: [["Stocks", "7"], ["Protocol fee", "0.5 %"], ["Fee cap", "1 %"]], note: "Quoted from Uniswap v3 against the Chainlink reference.", go: "Search a stock" },
  ] as (IndexCard | StocksCard)[],
};

/** The template's mountain photograph, kept as the neutral backdrop behind product mocks. */
export const BACKGROUND_IMAGE = "/assets/images/vv6ShYQM1T5frNtHgyN67Y8mFo.png";
