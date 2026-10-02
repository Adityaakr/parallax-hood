/* How it works (the About frame), Indices page, Notes index, Changelog, Contact and 404 content for Parallax on Robinhood Chain. */
import { LOGOS, PLANS, FAQS, REPO, DOCS } from "./site";

export const ABOUT = {
  pageTitle: "Parallax - How it works",
  header: {
    tag: "How it works",
    title: "A position is measured in shares, not tokens.",
    text: "A Robinhood stock token carries an on-chain multiplier, ERC-8056 uiMultiplier(), that grows with reinvested dividends and changes on splits. The number of tokens you hold is not the number of shares you own, so Parallax measures everything in underlying shares.",
    primary: { label: "Search a stock", href: "/stocks" },
    secondary: { label: "Read the docs", href: `${REPO}#readme` },
  },
  logos: LOGOS,
  manifesto: {
    tag: "Thesis",
    words: "A token is not a share. A Robinhood stock token carries a multiplier that grows with reinvested dividends and changes on splits. Parallax counts in underlying shares: it prices per share, bounds slippage in shares, defines an index unit in shares, and reverts if the shares do not arrive.".split(" "),
  },
  benefits: {
    tag: "Guarantees",
    title: "Conditions under which a transaction reverts.",
    text: "These are not policies an operator promises to follow. Each one is enforced on chain and has a test. None of it has been audited.",
    cards: [
      { icon: "double-check", title: "Backing", text: "After every state-changing call the vault holds at least units × sharesPerUnit of every constituent, or the call reverts.", dots: 1 },
      { icon: "link", title: "Redeem in kind", text: "No oracle, venue or pause that Parallax controls can block a holder from taking the stock tokens. The issuer can still pause or block its own token.", dots: 2 },
      { icon: "trend", title: "Migration is monotone", text: "A migration must increase the shares held of the constituent it touches, and may not reduce any other constituent or the vault's USDG.", dots: 3 },
      { icon: "sliders-v", title: "Slippage in shares", text: "A buy reverts unless the shares received reach minShares, with shares computed through the token's multiplier, not token units.", dots: 4 },
      { icon: "activity", title: "Legs trust balance deltas only", text: "SwapRouter02 is the only swap target. A leg approves it for exactly maxIn, calls it, resets the approval to zero and is judged by balance deltas.", dots: 5 },
      { icon: "bolt", title: "Agents never receive assets", text: "The mandate contract sends output to the owner. Caps, expiry, allowlists and the slippage bound are enforced on chain, and revocation is immediate.", dots: 6 },
    ],
  },
  team: {
    tag: "The stack",
    title: "A resolver and three contracts.",
    text: "A resolver that quotes from the chain, a router that fills in shares, vaults that hold the indices, and a mandate contract for agents.",
    members: [
      { visual: "resolve", name: "Resolver", role: "Quotes each stock per share" },
      { visual: "router", name: "ShareRouter", role: "Fills with minShares" },
      { visual: "basket", name: "BasketVault", role: "Holds an index, backing checked" },
      { visual: "mandate", name: "AgentMandate", role: "Caps an agent cannot exceed" },
    ],
  },
  faqs: FAQS,
};

export const PLANS_PAGE = {
  pageTitle: "Parallax - Indices",
  plans: PLANS,
  /* the reference compares three pricing tiers; here the three columns are the two indices and the single-stock path */
  comparison: {
    tag: "Comparison",
    title: "What each one holds and enforces.",
    text: "The first three rows say which stocks each column covers. The rest say what the contracts enforce for it.",
    head: ["Property", "pxMAG7", "pxAI", "Single stock"],
    rows: [
      ["NVDA", true, true, true],
      ["MSFT · GOOGL · META", true, true, true],
      ["AAPL · AMZN · TSLA", true, false, true],
      ["Paid for in USDG, filled through Uniswap v3", true, true, true],
      ["Measured in underlying shares", true, true, true],
      ["Allowed under an agent mandate", true, true, true],
      ["Backing checked after every call", true, true, false],
      ["Redeem in kind, with no fee", true, true, false],
      ["Vault supply capped at launch", true, true, false],
    ] as [string, boolean, boolean, boolean][],
    no: "no",
  },
  faqs: FAQS,
};

export const BLOG_INDEX = {
  pageTitle: "Parallax - Notes",
  tag: "Notes",
  title: "Notes from the port.",
  text: "Three things that changed when Parallax moved to Robinhood Chain, each grounded in docs/addresses.md.",
};

export const CHANGELOG_PAGE = {
  pageTitle: "Parallax - Changelog",
  tag: "Changelog",
  title: "What has landed.",
  text: "The Robinhood Chain port, step by step. Mainnet deployment is pending and is not in this list.",
};

export const CONTACT = {
  pageTitle: "Parallax - Get in touch",
  tag: "Contact",
  title: "Get in touch",
  text: "Questions about the contracts, the invariants or the Arbitrum Open House Singapore buildathon entry.",
  cards: [
    { label: "/Source", email: "github.com/Adityaakr/parallax-hood", href: REPO, dots: 1 },
    { label: "/Addresses", email: "docs/addresses.md", href: DOCS.addresses, dots: 2 },
  ],
  form: {
    fields: [
      { label: "Name*", placeholder: "Your name", type: "text", name: "Name" },
      { label: "Email*", placeholder: "Enter Your Email", type: "email", name: "Email" },
      { label: "Your message", placeholder: "What do you want to know?", type: "textarea", name: "Message" },
    ],
    button: "Open an issue",
    legal: { before: "This opens a GitHub issue; nothing is sent to us. See the ", terms: { label: "Terms of Service", href: "/legals/terms-of-service" }, and: " and ", privacy: { label: "Privacy Policy", href: "/legals/privacy-policy" }, after: "." },
  },
  faqs: {
    tag: "FAQs",
    title: "Questions?",
    text: "The ones people ask before they trust a contract with an order.",
    items: FAQS.items,
  },
};

export const NOT_FOUND = {
  pageTitle: "Parallax - Not found",
  title: "Error 404",
  text: "There is nothing at this address.",
  button: { label: "Back to home", href: "/" },
};

export const MORE_INSIGHTS = { tag: "More notes", title: "Notes from the port." };
