/* Legal pages for a buildathon prototype. Plain, short, honest. The eligibility quotation is the issuer's own
   wording, from https://docs.robinhood.com/chain/stock-tokens. */
import { REPO, NOT_AFFILIATED } from "./site";

const UPDATED = "<p><strong>Last updated: October 2, 2026</strong></p>";
const CONTACT = `Open an issue at <a href="${REPO}">github.com/Adityaakr/parallax-hood</a>.`;
const ISSUER_QUOTE = "Stock Tokens are not registered under U.S. securities laws and may not be offered, sold, or delivered, directly or indirectly, in the United States or to, or for the account or benefit of, U.S. persons. Offers and sales of Stock Tokens are subject to restrictions in other jurisdictions, including, without limitation, Canada, the United Kingdom, and Switzerland.";

export const LEGALS: Record<string, { title: string; pageTitle: string; body: string }> = {
  "privacy-policy": {
    title: "Privacy Policy",
    pageTitle: "Parallax - Privacy Policy",
    body: [
      UPDATED,
      "<p><strong>1. What this is</strong> Parallax on Robinhood Chain is a prototype built for the Arbitrum Open House Singapore buildathon. This page explains what the site and the app record about you, which is very little.</p>",
      "<p><strong>2. What we collect</strong> The web app runs in your browser and talks to a resolver service. The resolver logs the requests it serves (ticker, amount, and the wallet address you pass with a quote) and stores quote records keyed by their hash, so that a receipt on chain can be linked back to the scoring that produced it. It does not collect names or emails. The contact form opens a prefilled GitHub issue in your browser and the box in the footer opens the repository; neither sends anything to us.</p>",
      "<p><strong>3. Data on chain</strong> Anything you sign is public on Robinhood Chain, including your address, the tokens bought and the receipt emitted by the router or vault. That is the nature of a public chain, not a choice we make.</p>",
      "<p><strong>4. Third parties</strong> Reference prices come from Chainlink feeds and swaps go through Uniswap v3. The stock tokens are issued by Robinhood and USDG by Paxos. Your wallet and its connection service are your own choice. Their terms apply to their services. " + NOT_AFFILIATED + "</p>",
      "<p><strong>5. Retention</strong> Quote records and receipts are kept in the resolver's database for as long as the service runs. Ask and we will delete anything keyed to your address.</p>",
      "<p><strong>6. Contact</strong> " + CONTACT + "</p>",
    ].join(""),
  },
  "terms-of-service": {
    title: "Terms of Service",
    pageTitle: "Parallax - Terms of Service",
    body: [
      UPDATED,
      "<p><strong>1. What you are using</strong> Parallax on Robinhood Chain is unaudited software, built for the Arbitrum Open House Singapore buildathon. Use it at your own risk. It runs on Robinhood Chain Testnet with mock tokens and against a fork of mainnet with the real ones. It is not deployed on Robinhood Chain mainnet; that deployment is pending.</p>",
      "<p id=\"eligibility\"><strong>2. Eligibility</strong> Parallax is not available to U.S. persons. The issuer of the stock tokens states: \"" + ISSUER_QUOTE + "\" (source: <a href=\"https://docs.robinhood.com/chain/stock-tokens\">docs.robinhood.com/chain/stock-tokens</a>). You are responsible for knowing whether you may hold these tokens where you live.</p>",
      "<p><strong>3. No affiliation</strong> " + NOT_AFFILIATED + "</p>",
      "<p><strong>4. Not investment advice</strong> Nothing on this site or in the app is investment advice, and nothing here is an offer to sell securities. Index definitions and prices are shown for information only.</p>",
      "<p><strong>5. No custody</strong> Parallax never holds your funds on your behalf. You sign every transaction yourself, or an agent acts through a mandate you created and can revoke at any time. Output always goes to the wallet that owns the mandate.</p>",
      "<p><strong>6. Trust assumptions</strong> An admin key, a single deployer key for now, registers tokens and sets limits. Robinhood, as issuer, can pause a token, block an address, burn, and upgrade the token contracts. Paxos can pause USDG or freeze an address. Chainlink stock feeds do not update over the weekend; a stale price blocks agent buys only, never an owner's own trade or exit. Redeeming in kind does not depend on anything Parallax controls, but a token the issuer has paused or blocked cannot leave a vault until the issuer lifts that.</p>",
      "<p><strong>7. Fees</strong> The protocol fee is 0.5 % of USDG notional on buys, sells, mints and USDG redemptions. There is no fee on in-kind redemption. The contract caps the fee at 1 %. There is no Parallax token. You pay network gas on your own transactions.</p>",
      "<p><strong>8. Liability</strong> To the extent the law allows, the authors are not liable for losses arising from use of this software. It is unaudited and vault supply is capped at launch; do not use it with amounts you cannot afford to lose.</p>",
      "<p><strong>9. Contact</strong> " + CONTACT + "</p>",
    ].join(""),
  },
};
