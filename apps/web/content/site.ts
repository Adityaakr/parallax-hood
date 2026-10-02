/*
 * Site-wide content for Parallax. The layout, motion and every measurement stay the Syncrun
 * reconstruction's (see content/syncrun for the reference copy); only the words, links and imagery are
 * ours. Every figure traces to docs/recon.md, docs/decisions.md, contracts/script/config/bsc.json or a
 * recorded run named beside it.
 */

export const META = {
  title: "Parallax - one stock, many tokens, one true position",
  description: "Best execution and index layer for tokenized stocks on BNB Chain: Parallax quotes every issuer's token of a stock in underlying shares, fills at the cheapest, and packages themes into indices you can invest in with one click, hold, or delegate to an agent.",
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
  title: "Fill every share at its best representation.",
  text: "Invest in an index in one click, search a single stock, or hand an agent a mandate it cannot break. On BNB Chain, in underlying shares.",
  primary: { label: "Invest in an index", href: "/baskets" },
  secondary: { label: "Search a stock", href: "/stocks" },
};

export const FOOTER = {
  newsletter: { title: "Follow the build", text: "Recorded runs, invariant changes and the mainnet deployment, as they land.", placeholder: "Your Email", button: "Send", inputName: "Email" },
  columns: [
    { title: "Product", links: [["Search a stock", "/stocks"], ["Indices", "/baskets"], ["Activity", "/receipts"], ["Agents", "/mandates"], ["How it works", "/about"], ["Changelog", "/changelog"]] },
    { title: "Project", links: [["Notes", "/blog"], ["GitHub", "https://github.com/Adityaakr/parallax"], ["BNB Hack 2026", "https://www.bnbchain.org/en/hackathons/tokenized-stocks"]] },
    { title: "Legal", links: [["Privacy policy", "/legals/privacy-policy"], ["Terms of service", "/legals/terms-of-service"], ["404 Page", "/404"]] },
  ] as { title: string; links: [string, string][] }[],
};

/** The rails Parallax runs on. Logos we hold as files render as images; the rest render as wordmarks. */
export const LOGOS = {
  caption: "[ Built on BNB Chain ]",
  items: [
    { src: "/brand/badge-bnb.svg", w: 40, h: 40, label: "BNB Chain" },
    { src: "/brand/ondo.png", w: 40, h: 40, label: "Ondo" },
    { src: "/brand/bstocks.png", w: 40, h: 40, label: "bStocks" },
    { src: "/brand/badge-pancake.svg", w: 40, h: 40, label: "PancakeSwap" },
    { src: "", w: 0, h: 0, label: "Chainlink" },
    { src: "", w: 0, h: 0, label: "Binance Web3" },
    { src: "", w: 0, h: 0, label: "Uniswap v3" },
  ] as { src: string; w: number; h: number; label: string }[],
};

export const FAQS = {
  tag: "FAQs",
  title: "Questions?",
  text: "Everything asked before trusting a router with an order, including the ones with uncomfortable answers.",
  cta: { title: "More questions?", text: "The repository has the rest.", button: { label: "Read the docs", href: "https://github.com/Adityaakr/parallax#readme" } },
  items: [
    { q: "Is this live?", a: "Yes, on BNB Smart Chain mainnet since 22 September 2026: StockRegistry 0x84Af7451794aaDFa729d6e8e140B51169a6cfe7D, ShareRouter 0xcfAa542E4Dac083E440644EDF6C54f8d78B0579C, BasketFactory, AgentMandate and the three index vaults, all listed in the README with their BscScan links. The registry holds the 19 stocks the indices need and their 36 Ondo and bStocks tokens, with Chainlink feeds wired for the Mag 7. BSC testnet runs the same contracts against mock issuer tokens whose prices are mirrored from mainnet, with a faucet, for anyone who wants to try a mint without spending." },
    { q: "Why do two tokens of the same stock trade at different prices?", a: "Because they are different instruments. Ondo and bStocks each issue their own token against the same underlying, on their own venues, with their own share ratio. Nothing arbitrages them into line, so the effective cost per share can differ by tens of basis points at the same moment. On 17 September 2026 the two NVDA tokens were 39 bps apart on a mainnet fork. Parallax prices both and routes to the cheaper one." },
    { q: "What does \"denominated in shares\" actually mean?", a: "Slippage protection is normally written in token units, which is meaningless when one token is not one share. Parallax converts every quantity through the issuer's ratio first: bStocks expose uiMultiplier() onchain under ERC-8056, Ondo's ratio is posted by a bounded keeper. The router then reverts unless the shares credited meet the minimum you signed for." },
    { q: "Can the router run away with my funds?", a: "The swap calldata is untrusted by construction. Every leg targets an allowlisted contract, gets an approval sized to that leg which is reset to zero afterwards, and is credited only by the measured balance delta. There is no delegatecall, and an un-allowlisted target reverts with TargetNotAllowed." },
    { q: "What happens to an index if an issuer pauses its token?", a: "That constituent freezes inside the vault. Everything else keeps working, and redeeming in kind still works: it cannot be blocked by a pause, an oracle, a stale keeper or a registry freshness window. That is the escape hatch the invariants exist to protect." },
    { q: "Who can change an index's composition?", a: "Anyone, in one direction only. A migration must strictly increase the target constituent's share count by at least minShareGain, must not decrease any other constituent, and must not reduce the vault's USDT. A migration that is not share-accretive reverts; the fork test that proves it tried NVDAon into NVDAB through the 1% pool and was refused." },
    { q: "Is this audited?", a: "Not by a firm. It is a hackathon prototype that went through a 12-agent AI audit round (six findings, all fixed the same day, documented in docs/decisions.md), 124 unit, fuzz and invariant tests, 6 mainnet-fork tests against real BSC state and a stateful Medusa campaign of 270k calls with 93 properties clean, which is not the same thing as an audit. The trust assumptions are stated rather than hidden: ADMIN is a deployer EOA, and the keeper posts Ondo ratios under step and freshness limits." },
    { q: "What does it cost?", a: "A protocol fee of 0.5% of the USDT you trade, charged on buys, sells, index mints and USDT redemptions and shown on every quote before you sign. The contract caps it at 1%. Redeeming in kind carries no fee, so your exit never depends on anyone being paid. There is no token. Beyond that, users pay gas on their own transactions." },
  ],
};

/**
 * The three curated indices, in the Plans frame. Names, symbols, theses and constituents are the definitions
 * in contracts/script/config/bsc.json; returns, minimum and NAV are fetched live from the resolver and the
 * frame says so when they are not available.
 */
export const PLANS = {
  tag: "Indices",
  title: "Themes you invest in with one click.",
  text: "A unit is a fixed number of shares per constituent, not a promise. Every leg is routed through the same resolver, so the index inherits best execution; redeeming in kind can never be paused.",
  footnote: "Returns are price returns of one unit from Chainlink round history on BSC mainnet, dividends excluded; constituents without a feed are left out and the card says by how much. Minimum investment is $5, raised on an index where a constituent trades only through the aggregator's desk: the desk fills no leg under $5, so the order must be large enough to give that constituent its own $5. Not investment advice.",
  offline: "Live figures unavailable: the resolver is not reachable from this page right now.",
  cards: [
    { symbol: "pxMAG7", name: "Parallax Magnificent 7", thesis: "The seven US megacaps that dominate index returns, equal-weighted so no single name decides the unit.", tickers: ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA"] },
    { symbol: "pxAI", name: "Parallax AI Infrastructure", thesis: "The picks and shovels of AI compute: silicon, networking, memory, foundry and rented GPUs, not the model labs.", tickers: ["NVDA", "AMD", "AVGO", "TSM", "MRVL", "MU", "CRWV"] },
    { symbol: "pxNEW", name: "Parallax Private & Newly Public", thesis: "Exposure that is hard to get in a normal brokerage account: a pre-IPO name plus recent listings, tokenized.", tickers: ["SPCX", "CRCL", "CRWV", "COIN", "HOOD", "PLTR", "NBIS"] },
  ],
};

/** The template's mountain photograph, kept as the neutral backdrop behind product mocks. */
export const BACKGROUND_IMAGE = "/assets/images/vv6ShYQM1T5frNtHgyN67Y8mFo.png";
