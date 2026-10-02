/* How it works (the About frame), Indices page, Notes index, Changelog, Contact and 404 content for Parallax. */
import { LOGOS, PLANS, FAQS } from "./site";

export const ABOUT = {
  pageTitle: "Parallax - How it works",
  header: {
    tag: "How it works",
    title: "Best execution should be measured in shares, not tokens.",
    text: "We built Parallax because the same stock exists as several tokens on BNB Chain, each with its own ratio, venue and price, and nobody was pricing them against each other.",
    primary: { label: "Search a stock", href: "/stocks" },
    secondary: { label: "Read the docs", href: "https://github.com/Adityaakr/parallax#readme" },
  },
  logos: LOGOS,
  manifesto: {
    tag: "Thesis",
    words: ["A", "tokenized", "stock", "is", "not", "one", "asset.", "It", "is", "several", "tokens", "from", "several", "issuers,", "each", "worth", "a", "different", "number", "of", "shares.", "Parallax", "prices", "them", "all", "in", "shares,", "routes", "to", "the", "cheapest,", "and", "reverts", "if", "the", "shares", "do", "not", "arrive.", "No", "token,", "no", "fee,", "no", "promises", "a", "contract", "cannot", "keep."],
  },
  benefits: {
    tag: "Guarantees",
    title: "Conditions under which a transaction reverts.",
    text: "These are not policies an operator promises to follow. Each one is enforced onchain and has the test that proves it.",
    cards: [
      { icon: "double-check", title: "Backing ≥ 1.00", text: "For every constituent the vault holds at least totalSupply × sharesPerUnit / 1e18 shares after every state-changing call.", dots: 1 },
      { icon: "link", title: "Redeem in kind always works", text: "No pause, no oracle, no stale keeper and no registry freshness window can block a holder from taking their pro-rata tokens.", dots: 2 },
      { icon: "trend", title: "Migration is monotone", text: "A constituent's shares can only strictly increase, no other constituent can decrease, and vault USDT never falls.", dots: 3 },
      { icon: "sliders-v", title: "Slippage in shares", text: "buyShares reverts unless sharesOut ≥ minShares, with shares computed through registry ratios, not token units.", dots: 4 },
      { icon: "activity", title: "Legs trust balance deltas only", text: "Allowlisted target, forceApprove then reset to zero, spent ≤ maxIn, credited by the measured delta. No delegatecall.", dots: 5 },
      { icon: "bolt", title: "Agents never receive assets", text: "AgentMandate hardcodes the recipient to the owner; caps, expiry and allowlists are enforced onchain; revocation is instant.", dots: 6 },
    ],
  },
  team: {
    tag: "The stack",
    title: "Three layers and a keeper.",
    text: "A resolver that prices, contracts that execute and hold, and a bounded keeper that posts what the chain cannot see.",
    members: [
      { visual: "resolve", name: "Resolver", role: "Ranks every representation" },
      { visual: "router", name: "ShareRouter", role: "Fills with minShares" },
      { visual: "basket", name: "BasketVault", role: "Holds indices, backing ≥ 1.00" },
      { visual: "mandate", name: "AgentMandate", role: "Caps an agent cannot break" },
    ],
  },
  faqs: FAQS,
};

export const PLANS_PAGE = {
  pageTitle: "Parallax - Indices",
  plans: PLANS,
  comparison: {
    tag: "Comparison",
    title: "What each index holds.",
    text: "Seven constituents each, one vault receipt, the same guarantees on all three.",
    head: ["Constituent", "pxMAG7", "pxAI", "pxNEW"],
    rows: [
      ["NVDA", true, true, false],
      ["AAPL · MSFT · AMZN · GOOGL · META · TSLA", true, false, false],
      ["AMD · AVGO · TSM · MU", false, true, false],
      ["CRWV · NBIS", false, true, false],
      ["COIN · HOOD · PLTR · RDDT", false, false, true],
      ["ARM · CRCL · FIG", false, false, true],
      ["Minted through the resolver", true, true, true],
      ["Backing ≥ 1.00 after every call", true, true, true],
      ["Redeem in kind, unpausable", true, true, true],
      ["Monotone, permissionless migration", true, true, true],
      ["Minted end to end on the fork", true, false, false],
    ] as [string, boolean, boolean, boolean][],
    no: "no",
  },
  faqs: FAQS,
};

export const BLOG_INDEX = {
  pageTitle: "Parallax - Notes",
  tag: "Notes",
  title: "Notes from the build.",
  text: "What we measured, what we got wrong, and what the invariants turned out to protect.",
};

export const CHANGELOG_PAGE = {
  pageTitle: "Parallax - Changelog",
  tag: "Changelog",
  title: "What has landed.",
  text: "Phases and milestones as they were verified, with the run or test that proved each one.",
};

export const CONTACT = {
  pageTitle: "Parallax - Get in touch",
  tag: "Contact",
  title: "Get in touch",
  text: "Questions about the routing, the invariants or the hackathon submission.",
  cards: [
    { label: "/Source", email: "github.com/Adityaakr/parallax", href: "https://github.com/Adityaakr/parallax", dots: 1 },
    { label: "/Hackathon", email: "BNB Hack: Tokenized Stocks", href: "https://www.bnbchain.org/en/hackathons/tokenized-stocks", dots: 2 },
  ],
  form: {
    fields: [
      { label: "Name*", placeholder: "Your name", type: "text", name: "Name" },
      { label: "Email*", placeholder: "Enter Your Email", type: "email", name: "Email" },
      { label: "Your message", placeholder: "What are you trying to route?", type: "textarea", name: "Message" },
    ],
    button: "Open an issue",
    legal: { before: "By submitting, you agree to our ", terms: { label: "Terms of Service", href: "/legals/terms-of-service" }, and: " and ", privacy: { label: "Privacy Policy", href: "/legals/privacy-policy" }, after: "." },
  },
  faqs: {
    tag: "FAQs",
    title: "Questions?",
    text: "The ones people ask before they trust a router with an order.",
    items: FAQS.items,
  },
};

export const NOT_FOUND = {
  pageTitle: "Parallax - Not found",
  title: "Error 404",
  text: "No route here. Every real route is one search away.",
  button: { label: "Back to home", href: "/" },
};

export const MORE_INSIGHTS = { tag: "More notes", title: "Notes from the build." };
