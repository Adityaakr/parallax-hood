/*
 * Notes from the Robinhood Chain port. Three short notes, each grounded only in docs/addresses.md: every
 * address, reading and quotation below is in that file with its source and the on-chain check that confirmed
 * it (run on 2 October 2026). The covers are the template's own abstract art, reused; nothing was drawn for them.
 */
import { DOCS } from "./site";

export type Post = { slug: string; category: string; title: string; image: string; date: string; lede: string; pageTitle: string; author: { name: string; role: string; avatar: string }; body: string; related: string[] };

const AUTHOR = { name: "Parallax", role: "Build notes", avatar: "/parallax-icon.svg" };
const SOURCE = `<p>Source for everything above: <a href="${DOCS.addresses}" target="_blank" rel="noreferrer">docs/addresses.md</a>, which names the official page each fact was taken from and the read that confirmed it.</p>`;

export const POSTS: Post[] = [
  {
    slug: "a-token-is-not-a-share",
    category: "Tokens",
    title: "A token is not a share",
    image: "7N2J0ucrPSLmN4GCxrtq1bcDfY.png",
    date: "Oct 2, 2026",
    lede: "A Robinhood stock token carries a multiplier, and Chainlink's Robinhood feeds price the token. A per-share price needs one division, and Parallax does it on chain.",
    pageTitle: "A token is not a share",
    author: AUTHOR,
    body: `<h3>The balance in a wallet is raw.</h3>
<p>Robinhood stock tokens implement ERC-8056. Their <strong>balanceOf</strong> and <strong>totalSupply</strong> are raw and never rebase. What changes is <strong>uiMultiplier()</strong>, which grows with reinvested dividends and changes on splits. The number of shares behind a balance is the raw amount multiplied by the multiplier and divided by 1e18.</p>
<p>So the number of tokens you hold is not the number of shares you own. When we read the seven tokens on Robinhood Chain on 2 October 2026, five multipliers were already above one and two were exactly one:</p>
<ul>
<li><p>NVDA 1.000775, AAPL 1.000566, META 1.000541</p></li>
<li><p>MSFT 1.000413, GOOGL 1.000194</p></li>
<li><p>AMZN and TSLA exactly 1</p></li>
</ul>
<h3>The feed prices the token, not the share</h3>
<p>The Chainlink feeds for these tokens have 8 decimals, a 24 hour heartbeat and a 0.5 % deviation threshold, and run 24 hours a day, five days a week. Robinhood's documentation says what they measure: "The Chainlink price already includes the corporate-action multiplier (dividends, splits), so the value you read is the token's full price."</p>
<p>That answer is dollars per token. A price per share needs the division. <strong>StockRegistry.setTokenPriceFeed</strong> records which token a feed prices, and <strong>referencePrice</strong> divides the answer by that token's <strong>uiMultiplier()</strong>. The slippage floor in an agent mandate is therefore computed in dollars per share.</p>
<h3>What follows from it</h3>
<ul>
<li><p>Quotes are scored in dollars per underlying share against that per-share reference</p></li>
<li><p>Slippage protection is a minimum number of shares, <strong>minShares</strong>, not a minimum number of tokens</p></li>
<li><p>An index unit is a fixed number of underlying shares of each constituent</p></li>
</ul>
<h3>One limit</h3>
<p>The stock feeds do not publish while markets are closed, so they stop over the weekend and on market holidays. A stale price blocks agent buys only. It never blocks an owner's own trade or an exit.</p>
${SOURCE}`,
    related: ["usdg-has-six-decimals", "what-the-testnet-does-not-have"],
  },
  {
    slug: "usdg-has-six-decimals",
    category: "Engineering",
    title: "USDG has six decimals",
    image: "y0yJSJrbAEeeZQJ3vgVgvfDKt8.png",
    date: "Oct 2, 2026",
    lede: "The quote and settlement asset on Robinhood Chain is USDG, with 6 decimals. Everything else in Parallax is scaled to 1e18. This is where the two meet.",
    pageTitle: "USDG has six decimals",
    author: AUTHOR,
    body: `<h3>Two scales in one contract.</h3>
<p>USDG, the Paxos Global Dollar, is the asset Parallax quotes and settles in on Robinhood Chain. Its <strong>decimals()</strong> returns 6. Every share quantity, multiplier and dollar price inside Parallax is 1e18-scaled, and the stock tokens themselves have 18 decimals. Earlier code assumed the quote asset had 18 decimals too, so a dollar amount and a share amount could be mixed without a conversion. That assumption had to go.</p>
<h3>What changed</h3>
<ul>
<li><p>On chain, <strong>AgentMandate.quoteScale</strong> converts explicitly between USDG units and the 1e18 scale where the two meet</p></li>
<li><p>In the SDK, <strong>usdgToWad</strong> and <strong>wadToUsdg</strong> do the same conversion off chain</p></li>
<li><p>The testnet mock, <strong>MockUSDG</strong>, has 6 decimals as well, so the testnet deployment uses the same scale as mainnet</p></li>
</ul>
<h3>A quote, to show the scale is right</h3>
<p>Asking QuoterV2 for 100 USDG of NVDA at the 0.05 % fee tier means passing 100000000 as the amount in. When checked, it returned 431066873140846993, which is 0.431 NVDA tokens. That is 231.98 dollars a token, against a Chainlink answer of 231.40 dollars at the same time.</p>
<h3>What USDG is, and is not</h3>
<p>From its verified source and simulated calls: transfer, transferFrom and approve return a bool, there is no fee on transfer, it does not rebase, and it does not require an approval to be reset to zero first. Paxos can pause it and can freeze an address, and its admin can upgrade it. Parallax takes USDG at one dollar and does not read a USDG price feed.</p>
${SOURCE}`,
    related: ["a-token-is-not-a-share", "what-the-testnet-does-not-have"],
  },
  {
    slug: "what-the-testnet-does-not-have",
    category: "Testnet",
    title: "What the testnet does not have",
    image: "EK5aqe0bRCriNIymfbiKUN8o.png",
    date: "Oct 2, 2026",
    lede: "Robinhood Chain Testnet has no Uniswap, no price feeds and only five test stock tokens. This is what Parallax mocks there, and how it is labelled.",
    pageTitle: "What the testnet does not have",
    author: AUTHOR,
    body: `<h3>What exists on chain 46630.</h3>
<p>Robinhood Chain Testnet has real USDG, WETH and five test stock tokens from the Robinhood faucet: TSLA, AMZN, PLTR, NFLX and AMD. All five have a multiplier of exactly 1.</p>
<h3>What is missing</h3>
<ul>
<li><p>No Uniswap v3 deployment: the mainnet factory, quoter and router addresses have no code there</p></li>
<li><p>No Chainlink price feed of any kind</p></li>
<li><p>No NVDA, AAPL, MSFT, GOOGL or META token, so five of the seven stocks Parallax supports do not exist</p></li>
</ul>
<h3>What Parallax mocks, and why</h3>
<ul>
<li><p><strong>Stock tokens</strong>: MockStockToken, one per stock, carrying its mainnet token's multiplier. The faucet's supply could not seed a venue even for the two stocks that exist.</p></li>
<li><p><strong>USDG</strong>: MockUSDG, with 6 decimals. The Paxos faucet gives about 100 USDG a day per wallet, which is not enough to fund a venue's sell side.</p></li>
<li><p><strong>Swap venue</strong>: MockSwapTarget, because there is no Uniswap on testnet.</p></li>
<li><p><strong>Reference prices</strong>: posted once from the mainnet Chainlink answers at generation time, because there are no feeds on testnet.</p></li>
</ul>
<p>Each of these is labelled as mocked in every API response and on every screen. A testnet run shows that the contracts enforce what they say. It does not show anything about real liquidity or real prices.</p>
<h3>Where the real ones are exercised</h3>
<p>The real tokens, feeds and pools are exercised by a fork test against Robinhood Chain mainnet. Parallax is not deployed on mainnet; that deployment is pending, and the code is unaudited.</p>
${SOURCE}`,
    related: ["a-token-is-not-a-share", "usdg-has-six-decimals"],
  },
];
