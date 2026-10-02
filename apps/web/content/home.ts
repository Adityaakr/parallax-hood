/*
 * Home page content for Parallax on Robinhood Chain, in the reference's section shapes. Every figure is one
 * of: 7 stocks, 2 indices, 139 Foundry tests, the 0.5 % fee and its 1 % cap, the index weights, the chain ids.
 * Sources: docs/addresses.md and contracts/script/config/robinhood.json.
 */
import { LOGOS, PLANS, FAQS, REPO, DOCS } from "./site";

const MARK = "/parallax-icon.svg";

export const HOME = {
  header: {
    tag: "Parallax on Robinhood Chain",
    title: "One stock. Many tokens. One true position, in shares.",
    text: "A token is not a share. A Robinhood stock token carries an on-chain multiplier that grows with reinvested dividends and changes on splits, so the number of tokens you hold is not the number of shares you own. Parallax measures everything in underlying shares: USDG index vaults, agent mandates and execution. Tested against a fork of Robinhood Chain mainnet; public deployment is pending.",
    primary: { label: "View the indices", href: "/baskets" },
    secondary: { label: "Search a stock", href: "/stocks" },
    /* the UI-Card's typewriter: someone asking an agent to quote, decide and execute through Parallax */
    ui: { model: "Fork of Robinhood Chain", phrases: [
      "How many shares of NVDA does one NVDA token stand for right now?",
      "Mint one unit of pxMAG7 with USDG and show me the receipts.",
      "Quote AAPL in dollars per share against the Chainlink price.",
      "Buy NVDA inside my mandate and send the output to the owner.",
      "What does one unit of pxAI hold, in shares of each stock?",
      "Redeem my pxMAG7 in kind and send the stock tokens to my wallet.",
      "Is the TSLA price stale? If it is, do not buy.",
    ] },
    /* the reference's testimonial card: a statement of fact with its source, not a quote from a person */
    review: { rating: "ERC-8056", ratingLabel: "uiMultiplier()", quote: "A wallet balance is raw tokens. Shares are that balance multiplied by the token's multiplier, which grows with reinvested dividends and changes on splits.", name: "A token is not a share", role: "docs/addresses.md", avatar: MARK, social: DOCS.addresses },
    logos: LOGOS,
  },
  features: {
    tag: "What it does",
    title: "Index, delegate and execute.",
    text: "Parallax does three things, and each of them is measured in underlying shares.",
    cards: [
      { label: "Index vaults", title: "A unit is a fixed number of shares.", text: "A basket such as pxMAG7 is defined by underlying shares of each constituent, not by a dollar weight that drifts with a manager. You deposit USDG and the vault buys each stock through Uniswap v3 in the same transaction.", items: ["Holds at least units × sharesPerUnit of every constituent, or the call reverts", "Redeem for USDG, or in kind for the stock tokens", "In-kind exit needs no oracle, venue or pause that Parallax controls"], visual: "basket" as const },
      { label: "Agent mandates", title: "An agent that cannot take the assets.", text: "A wallet owner gives an AI agent a per-transaction cap and a daily cap in USDG, an expiry, an allowlist of stocks and vaults, and a maximum slippage against the Chainlink price. The agent trades through the mandate contract.", items: ["Output always goes to the owner", "Revocation is one transaction and immediate", "MCP server with read tools and one write tool"], visual: "mandate" as const },
      { label: "Execution per share", title: "Priced in dollars per share.", text: "Quotes come straight from the chain: the Uniswap v3 factory and QuoterV2, across fee tiers and through WETH where that returns more. Each is scored in dollars per underlying share against the Chainlink reference.", items: ["Slippage protection in shares: minShares", "SwapRouter02 is the only contract on the swap allowlist", "A receipt on chain links to the scoring record"], visual: "receipt" as const },
    ],
  },
  integrations: {
    tag: "Integrations",
    title: "Built on contracts that are already there.",
    text: "Parallax adds no venue, no token and no bridge. It reads the stock tokens, the pools and the price feeds already on Robinhood Chain, an Arbitrum Orbit L2 on Ethereum.",
    items: ["Share counts read on chain from each token's ERC-8056 uiMultiplier()", "Uniswap v3 is the venue; SwapRouter02 is the only swap target allowed", "Chainlink prices the token; Parallax converts to a per-share price on chain"],
    /* the 4 × 4 grid: names of what the system is built with, as plain text. No third-party logos. */
    marks: ["Robinhood Chain", "USDG", "Uniswap v3", "Chainlink", "ERC-8056", "Arbitrum Orbit", "SwapRouter02", "QuoterV2", "WETH", "Foundry", "viem", "MCP", "OpenZeppelin", "wagmi", "zod", "Next.js"].map((label) => ({ src: "", label })),
  },
  metrics: {
    tag: "Measured",
    title: "Four numbers, each one checkable.",
    text: "Each figure comes from the repository or from a read of the chain. None of them is a usage, volume or performance figure, because there are none to report yet.",
    left: [
      { label: "Stocks", end: 7, decimals: 0, symbol: "", prefix: "", text: "NVDA, AAPL, MSFT, AMZN, GOOGL, META and TSLA. Each token and feed address was taken from its official list and checked on chain.", dots: 1 },
      { label: "Indices", end: 2, decimals: 0, symbol: "", prefix: "", text: "pxMAG7 holds the seven at equal weight. pxAI holds NVDA at 40 % and MSFT, GOOGL and META at 20 % each.", dots: 2 },
    ],
    right: [
      { label: "Foundry tests", end: 139, decimals: 0, symbol: "", prefix: "", text: "Including fuzz and handler-based invariant suites, plus a fork test against the real tokens, feeds and pools. Not an audit.", dots: 3 },
      { label: "Protocol fee", end: 0.5, decimals: 1, symbol: " %", prefix: "", text: "Of USDG notional on buys, sells, mints and USDG redemptions. None on in-kind redemption. Hard-capped at 1 % in the contract.", dots: 4 },
    ],
    /* the calculator: the protocol fee on an order, at the current 0.5 % and anywhere up to the contract's 1 % cap.
       defaultLevel and maxLevel are basis points. */
    calculator: { label1: "ORDER SIZE IN USDG", label2: "PROTOCOL FEE, CAPPED AT 1 %", tasksLabel: "FEE", perMonth: "/ order", result1: "PER ORDER", result2: "ON 10 ORDERS", defaultTasks: 1_000, defaultLevel: 50, maxLevel: 100 },
  },
  process: {
    tag: "How it works",
    title: "From USDG to a position in three steps.",
    text: "Most of the work happens before you sign: the transaction handed to your wallet has already been quoted from the chain and bounded in shares.",
    button: { label: "Search a stock", href: "/stocks" },
    steps: [
      { icon: "link", title: "Connect", text: "Bring a wallet you control. There is no account and no custody: the resolver reads the chain and hands back an unsigned transaction.", dots: 1 },
      { icon: "sliders-v", title: "Quote", text: "Each stock is quoted from Uniswap v3 and shown in dollars per underlying share, next to the Chainlink reference for the same share.", dots: 2 },
      { icon: "bolt", title: "Sign", text: "Sign once. ShareRouter fills with a minimum in shares, or a BasketVault buys every constituent of an index in the same transaction.", dots: 3 },
    ],
  },
  /* The reference's Reviews frame. Parallax has no users to quote, so the cards carry what the contracts
     enforce and what a holder still has to trust, each with the document it comes from. */
  reviews: {
    tag: "Trust",
    title: "What is enforced, and what you still trust.",
    text: "Each card names the document it comes from. None of this has been audited.",
    large: { quote: "The contracts have been run on a local chain with mock tokens, and against a fork of Robinhood Chain mainnet with the real tokens, feeds and pools. Nothing is deployed to a public network yet. The code is unaudited, and a vault's supply can be capped by the admin.", name: "Status", role: "Fork of Robinhood Chain · chain id 4663", social: REPO },
    ticker: [
      { rating: "Enforced", quote: "After every call the vault must hold at least units × sharesPerUnit of every constituent, or the call reverts.", avatar: MARK, name: "Backing", role: "docs/invariants.md", social: DOCS.invariants },
      { rating: "Enforced", quote: "Redeeming in kind does not depend on any oracle, venue or pause that Parallax controls, and carries no fee.", avatar: MARK, name: "Redeem in kind", role: "docs/invariants.md", social: DOCS.invariants },
      { rating: "Enforced", quote: "An agent trades through the mandate contract and can never receive the assets. Output always goes to the owner.", avatar: MARK, name: "Agent mandate", role: "docs/invariants.md", social: DOCS.invariants },
      { rating: "Trusted", quote: "Robinhood, as issuer, can pause a token, block an address, burn, and upgrade the token contracts.", avatar: MARK, name: "The issuer", role: "docs/threat-model.md", social: DOCS.threatModel },
      { rating: "Trusted", quote: "Paxos can pause USDG or freeze an address. An admin key, a single deployer key for now, registers tokens and sets limits.", avatar: MARK, name: "USDG and the admin key", role: "docs/threat-model.md", social: DOCS.threatModel },
      { rating: "Trusted", quote: "Chainlink stock feeds do not update over the weekend. A stale price blocks agent buys only, never an owner's own trade or exit.", avatar: MARK, name: "Price feeds", role: "docs/addresses.md", social: DOCS.addresses },
      { rating: "139 tests", quote: "Foundry tests with fuzz and handler-based invariant suites, plus a fork test against the real tokens, feeds and pools. Not audited.", avatar: MARK, name: "Test suite", role: "contracts/test", social: REPO },
    ],
    ratingLabel: "",
  },
  plans: PLANS,
  faqs: FAQS,
  blog: {
    tag: "Notes",
    title: "Notes from the port.",
    text: "Three things that changed when Parallax moved to Robinhood Chain.",
    slugs: ["a-token-is-not-a-share", "usdg-has-six-decimals", "what-the-testnet-does-not-have"],
    viewAll: { label: "View all", href: "/blog" },
  },
};
