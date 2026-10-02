/* Home page content for Parallax, in the reference's section shapes. Sources are named per figure. */
import { LOGOS, PLANS, FAQS } from "./site";

export const HOME = {
  header: {
    tag: "Best execution and index layer for tokenized stocks",
    title: "One stock, many tokens, one true position.",
    text: "Invest in a theme of tokenized stocks in one click. Every stock on BNB Chain has several issuers and several prices; Parallax quotes all of them in underlying shares, fills each leg at the cheapest, and hands you one index unit you can hold, redeem in kind or delegate to an agent.",
    primary: { label: "Invest in an index", href: "/baskets" },
    secondary: { label: "Search a stock", href: "/stocks" },
    /* the UI-Card's typewriter: someone asking an agent to find, decide and execute through Parallax */
    ui: { model: "BSC mainnet", phrases: [
      "Invest $500 for me in the index with the best 1-year return.",
      "Find the cheapest way to own 2 shares of NVDA and execute it.",
      "Put $1,000 into pxMAG7, fill every leg at the best issuer, and show me the receipts.",
      "Compare every NVDA token on BNB Chain and buy the one with the lowest premium.",
      "Which index gives me AI exposure? Invest $250 in it, minimum slippage.",
      "Rebalance my pxAI into a cheaper issuer only if I end up with more shares.",
      "Redeem all my pxMAG7 in kind and send the tokens to my wallet.",
    ] },
    review: { rating: "17", ratingLabel: "bps apart", quote: "\"NVDAon quotes $227.31 a share and NVDAB $227.48, against a Chainlink reference of $228.17. Same stock, same second, two issuers, and the cheaper one is not the one you would have guessed.\"", name: "Live on BSC mainnet", role: "StockRegistry · 22 Sep 2026", avatar: "/brand/badge-bnb.svg", social: "https://bscscan.com/address/0x84Af7451794aaDFa729d6e8e140B51169a6cfe7D" },
    logos: LOGOS,
  },
  features: {
    tag: "The execution layer",
    title: "Search, route and verify.",
    text: "Three things happen between typing a ticker and holding a position. Parallax makes all three legible.",
    cards: [
      { label: "Search", title: "Every issuer, one price.", text: "A stock has as many prices as it has issuers. Parallax quotes all of them and normalizes each to underlying shares, so the comparison is real rather than nominal.", items: ["19 stocks live on mainnet, 36 tokens", "Ondo and bStocks priced side by side", "Effective cost per share, not per token"], visual: "resolve" as const },
      { label: "Route", title: "Fill at the best one.", text: "PancakeSwap pools and the Binance aggregator are quoted together and executed through a router whose slippage bound is denominated in shares, not token units.", items: ["Pools and aggregator in one ranking", "minShares computed from registry ratios", "Split across issuers when a cap binds"], visual: "router" as const },
      { label: "Verify", title: "Read the reason after.", text: "Every fill emits a receipt whose quote hash resolves to the scoring record that produced it: the candidates, their premiums, and the policy that was applied.", items: ["Quote hash on every receipt", "Candidates and premiums preserved", "Simulated before it is ever signed"], visual: "receipt" as const },
    ],
  },
  integrations: {
    tag: "Integrations",
    title: "Works with the liquidity that already exists.",
    text: "No new venue, no new token, no bridge. Parallax reads the issuers and venues already on BNB Chain and routes between them.",
    items: ["Two issuers today, Ondo and bStocks, with the registry open to more", "Pools and RFQ desks quoted through one aggregator, never a single venue", "Chainlink reference prices and issuer attestations gate every buy"],
    /* the 4 × 4 grid: the marks we hold as files, then wordmarks for the rest */
    marks: [
      { src: "/brand/badge-bnb.svg", label: "BNB Chain" }, { src: "/brand/ondo.png", label: "Ondo" }, { src: "/brand/bstocks.png", label: "bStocks" }, { src: "/brand/badge-pancake.svg", label: "PancakeSwap" },
      { src: "", label: "Uniswap v3" }, { src: "", label: "Kipseli" }, { src: "", label: "Metric" }, { src: "", label: "Halfmoon" },
      { src: "", label: "Neptune" }, { src: "", label: "Chainlink" }, { src: "", label: "Binance Web3" }, { src: "", label: "ERC-8056" },
      { src: "", label: "Tessera" }, { src: "", label: "Foundry" }, { src: "", label: "viem" }, { src: "", label: "MCP" },
    ],
  },
  metrics: {
    tag: "Measured",
    title: "The numbers behind the routing.",
    text: "Each figure comes from the live mainnet deployment or from the repository itself. None of them are illustrative.",
    left: [
      { label: "Underlyings live", end: 19, decimals: 0, symbol: "", prefix: "", text: "Stocks registered in the mainnet StockRegistry, every constituent of the three indices. The catalogue behind it carries 42.", dots: 1 },
      { label: "Representations", end: 36, decimals: 0, symbol: "", prefix: "", text: "Ondo and bStocks tokens the mainnet registry prices in underlying shares, two issuers per stock.", dots: 2 },
    ],
    right: [
      { label: "NVDA spread", end: 17, decimals: 0, symbol: " bps", prefix: "", text: "Between the two issuers of the same stock, quoted in the same second on mainnet, 22 Sep 2026. It moves: the point is that it is never zero.", dots: 3 },
      { label: "NVDA route depth", end: 2.3, decimals: 1, symbol: "M", prefix: "$", text: "USDT in NVDAB's PancakeSwap v3 pools, read onchain. NVDAon's hold $11.5K, which is why the two prices diverge.", dots: 4 },
    ],
    /* the calculator: what routing blind leaves behind, seeded at the spread measured on mainnet on 22 Sep */
    calculator: { label1: "ORDER SIZE", label2: "SPREAD BETWEEN ISSUERS", tasksLabel: "LEFT BEHIND", perMonth: "/ order", days: ["N", "A", "M", "G", "M", "T", "C"], result1: "PER ORDER", result2: "ON 10 ORDERS", defaultTasks: 25_000, defaultLevel: 17 },
  },
  process: {
    tag: "How it works",
    title: "From a ticker to a position in three steps.",
    text: "Most of the work happens before you sign: the transaction handed to your wallet has already been priced, bounded and simulated.",
    button: { label: "Search a stock", href: "/stocks" },
    steps: [
      { icon: "link", title: "Connect", text: "Bring a wallet on BNB Chain. No account, no custody, no signup: the resolver reads the chain and hands back an unsigned transaction.", dots: 1 },
      { icon: "sliders-v", title: "Compare", text: "Every representation of the stock, priced in underlying shares, with its premium against the Chainlink reference shown next to it.", dots: 2 },
      { icon: "bolt", title: "Execute", text: "Sign once. ShareRouter fills with a share-denominated minimum, or a BasketVault mints a whole index in a single call.", dots: 3 },
    ],
  },
  reviews: {
    tag: "Evidence",
    title: "Deployed, audited, recorded.",
    text: "Each card names the transaction, file or run it came from, so it can be checked rather than believed.",
    large: { image: "/assets/images/LT8btWGzlVT8iH26EzODSoZ6OE.png", quote: "\"Registry, router, factory, agent mandate and three index vaults, deployed to BSC mainnet for 0.00183 BNB. Chainlink feeds wired for the Mag 7, the protocol fee set to 0.5 %, and pxMAG7 quoting a full seven-leg mint the same afternoon.\"", name: "Live on BSC mainnet", role: "22 Sep 2026 · contracts/deployments/56.json", social: "https://bscscan.com/address/0x84Af7451794aaDFa729d6e8e140B51169a6cfe7D", socialIcon: "x-logo" },
    ticker: [
      { rating: "0.900979", quote: "\"One aggregator leg credited 0.900979 NVDA shares to ShareRouter through the allowlisted router, for 452k gas. The calldata was opaque; the balance delta was not.\"", avatar: "/brand/badge-bnb.svg", name: "Aggregator execution", role: "scripts/e2e/aggregator-fork.mts", social: "https://github.com/Adityaakr/parallax", socialIcon: "x-logo" },
      { rating: "−37 bps", quote: "\"$100 of NVDA on mainnet resolved to NVDAon at $227.31 a share, 37 bps under the Chainlink reference, after scoring both issuers on cost per underlying share.\"", avatar: "/brand/ondo.png", name: "Resolver, live", role: "apps/resolver · 22 Sep 2026", social: "https://github.com/Adityaakr/parallax", socialIcon: "x-logo" },
      { rating: "reverted", quote: "\"Migrating NVDAon into NVDAB through the 1% pool was not share-accretive at that block. The vault rejected it, as the invariant requires.\"", avatar: "/brand/ondo.png", name: "Invariant, tested", role: "contracts/test/fork/Mainnet.t.sol", social: "https://github.com/Adityaakr/parallax", socialIcon: "x-logo" },
      { rating: "refused", quote: "\"agent → buy $500 NVDA: refused, exceeds per-tx cap 50. Checked before sending, then enforced onchain regardless.\"", avatar: "/brand/badge-bnb.svg", name: "Agent mandate", role: "apps/mcp · execute_with_mandate", social: "https://github.com/Adityaakr/parallax", socialIcon: "x-logo" },
      { rating: "+288 bps", quote: "\"The keeper's migration bot moved a constituent to a cheaper issuer at +288 bps of shares on the mocks chain, and skipped ratios and attestations it had no source for.\"", avatar: "/brand/badge-pancake.svg", name: "Keeper, dry run and live", role: "docs/decisions.md · Phase 4", social: "https://github.com/Adityaakr/parallax", socialIcon: "x-logo" },
      { rating: "124", quote: "\"124 unit, fuzz and invariant tests, 6 mainnet-fork tests, a 12-agent audit round with every finding fixed, and a stateful Medusa suite: 93 properties, 270k calls, clean.\"", avatar: "/brand/badge-bnb.svg", name: "Test suite", role: "contracts/test", social: "https://github.com/Adityaakr/parallax", socialIcon: "x-logo" },
    ],
    ratingLabel: "",
  },
  plans: PLANS,
  faqs: FAQS,
  blog: {
    tag: "Notes",
    title: "Notes from the build.",
    text: "What we measured, what we got wrong, and what the invariants turned out to protect.",
    slugs: ["two-tokens-one-stock", "how-an-order-travels", "agent-mandates"],
    viewAll: { label: "View all", href: "/blog" },
  },
};
