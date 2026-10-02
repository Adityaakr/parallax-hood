/*
 * Notes from the build. Every figure is re-derived from a recorded run, an onchain read or a file in this
 * repository before it is written down. The cover of each post is a specimen of the artifact it is about,
 * drawn in the site's own type and colour by scripts/gen-covers.mjs; every figure on one appears in the post.
 */
export type Post = { slug: string; category: string; title: string; image: string; date: string; lede: string; pageTitle: string; author: { name: string; role: string; avatar: string }; body: string; related: string[] };

const AUTHOR = { name: "Parallax", role: "Build notes", avatar: "/parallax-icon.svg" };

export const POSTS: Post[] = [
  {
    slug: "two-tokens-one-stock",
    category: "Recon",
    title: "Two tokens, one stock, two prices",
    image: "cover-two-tokens-one-stock.png",
    date: "Sep 17, 2026",
    lede: "NVIDIA exists twice on BNB Chain. The two tokens do not agree on what a share costs, nothing arbitrages them into line, and that gap is the entire reason Parallax exists.",
    pageTitle: "Two tokens, one stock, two prices",
    author: AUTHOR,
    body: `<h3>The same stock exists twice, and the two prices disagree.</h3>
<p>We started by checking one thing: if NVIDIA is tokenized twice on BNB Chain, do the two tokens cost the same? They do not, they have never converged, and the cheaper side is not stable. Everything we built after that is a consequence.</p>
<p><a href="https://ondo.finance" target="_blank" rel="noreferrer">Ondo</a> issues <strong>NVDAon</strong>. bStocks issues <strong>NVDAB</strong>. Both claim the same underlying share. They are different instruments from different issuers, held in different custody, traded on different venues. Nothing connects them. There is no redemption arbitrage a trader on BNB Chain can run, so the spread between them is structural rather than a fleeting inefficiency.</p>
<h3>A token is not a share</h3>
<p>The first thing that breaks naive comparison is that one token is not one share. Both issuers reinvest dividends, so a token slowly represents more than a share.</p>
<p>bStocks publishes this onchain. NVDAB implements <a href="https://eips.ethereum.org/EIPS/eip-8056" target="_blank" rel="noreferrer">ERC-8056</a> and exposes <strong>uiMultiplier()</strong>, which read 1.000778 when we measured it. Ondo does not: its GMToken is a plain ERC-20 and the ratio, 1.0037 at the time, only exists in an API response. That asymmetry is why our <a href="https://github.com/Adityaakr/parallax/blob/main/contracts/src/StockRegistry.sol" target="_blank" rel="noreferrer">registry</a> carries two ratio sources, one read live from the token and one posted by a keeper inside a step bound, and it is why both are stored the same way: shares per token, scaled to 1e18.</p>
<p>Compare the two tokens by price and you compare the wrong quantity. Convert both to underlying shares first and the comparison becomes real.</p>
<h3>What we measured</h3>
<p>On 17 September, against real tokens and real pools on a mainnet fork, PancakeSwap priced NVDAB at $219.49 per raw token. Divided by its multiplier that is $219.35 per share, against a <a href="https://docs.chain.link/data-feeds/price-feeds/addresses?network=bnb-chain" target="_blank" rel="noreferrer">Chainlink</a> reference of $219.18. Routing $100 of NVDA through our <a href="https://github.com/Adityaakr/parallax/blob/main/apps/resolver/src/scoring.ts" target="_blank" rel="noreferrer">resolver</a> landed NVDAB at $219.01 per share, 8 bps under the reference. The same block put NVDAon 31 bps over it.</p>
<ul>
<li><p>39 bps between the two tokens of the same stock, at the same moment</p></li>
<li><p>NVDAB pool: $1.24M of USDT liquidity at the 0.25% tier</p></li>
<li><p>NVDAon pool: $8.7k at the 1% tier</p></li>
</ul>
<p>On 22 September, live on mainnet, we ran the same query. NVDAon quoted $227.31 a share, 37 bps under a Chainlink reference of $228.17. NVDAB quoted $227.48, 29 bps under. Seventeen bps apart, and the cheaper side had flipped.</p>
<p>That flip is the point. A router hardcoded to one issuer would have been on the wrong side of the trade on one of those two days. There is no permanently better issuer, only a better issuer right now.</p>
<h3>Depth is asymmetric too</h3>
<p>Price is not the only thing that differs. Reading the pools directly on mainnet, NVDAB sits in <a href="https://developer.pancakeswap.finance/contracts/v3/addresses" target="_blank" rel="noreferrer">PancakeSwap v3</a> pools holding about $2.3M of USDT across three fee tiers. NVDAon holds roughly $11.5k. Same stock, two hundred times the depth on one side.</p>
<p>It gets sharper further down the catalogue. Apple and Amazon exist on BSC only as Ondo tokens, and their pools are dust: a $5 buy of AAPLon quotes 8,000 bps of slippage. Their only usable route is the <a href="https://www.binance.com/en/web3" target="_blank" rel="noreferrer">Binance</a> aggregator, whose RFQ desks answer <strong>Minimum order amount is 5 USD</strong> for anything at or below $5.00 and fill from $5.05. We <a href="https://github.com/Adityaakr/parallax/blob/main/scripts/probe-desk.mts" target="_blank" rel="noreferrer">measured that boundary</a> rather than guessing it, and it is what sets the minimum order size on any index holding those names.</p>
<h3>What follows from this</h3>
<p>If the spread is structural, moves, and reverses, then best execution for a tokenized stock is not a routing nicety. It is the product. A router that prices every representation in underlying shares can take the cheaper side each time and refuse the fill when the shares do not arrive.</p>
<p>That is what ShareRouter does, and why <a href="/blog/slippage-in-shares">its slippage bound is written in shares</a> rather than token units. You can see the current spread for any stock on the <a href="/stocks">search page</a>.</p>`,
    related: ["slippage-in-shares", "how-an-order-travels", "backing-invariant"],
  },
  {
    slug: "slippage-in-shares",
    category: "Engineering",
    title: "Slippage protection has to be denominated in shares",
    image: "cover-slippage-in-shares.png",
    date: "Sep 18, 2026",
    lede: "A minimum written in token units is meaningless when one token is not one share. How ShareRouter computes minShares, why it never reads the swap calldata, and what it refuses.",
    pageTitle: "Slippage protection has to be denominated in shares",
    author: AUTHOR,
    body: `<h3>The obvious design is quietly wrong.</h3>
<p>Every router takes a minimum output. Set <strong>minTokensOut</strong>, revert if the swap returns less, done. That protection is real when the output token is the thing you wanted. It is theatre when four tokens all claim the same underlying and each is worth a different number of shares.</p>
<p><a href="/blog/two-tokens-one-stock">One stock, several issuers</a>, and each token is worth a different number of shares. Ask for 2 shares of NVIDIA and a router with a token-unit minimum will happily hand you 2 NVDAB, which is 2.0016 shares, or 2 NVDAon, which is 2.0074 shares, or a token whose ratio drifted overnight. The minimum was satisfied. The position is not what you signed for.</p>
<h3>Convert first, then bound</h3>
<p>Parallax puts the conversion before the check. Every quantity crosses into underlying shares through the issuer ratio the registry holds:</p>
<ul>
<li><p><strong>shares = tokens &#215; ratio / 1e18</strong>, rounded down, so a fill never over-credits</p></li>
<li><p><strong>tokens = shares &#215; 1e18 / ratio</strong>, rounded up, so a vault never under-holds</p></li>
</ul>
<p>Those two roundings point in opposite directions on purpose, and both favour the protocol. The mirror of this <a href="https://github.com/Adityaakr/parallax/blob/main/contracts/src/libraries/ShareMath.sol" target="_blank" rel="noreferrer">math</a> lives in the TypeScript SDK with parity tests against vectors the Solidity generates, because a quote that disagrees with the contract is a quote that reverts.</p>
<p><strong><a href="https://github.com/Adityaakr/parallax/blob/main/contracts/src/ShareRouter.sol" target="_blank" rel="noreferrer">ShareRouter.buyShares</a></strong> then sums what the legs actually delivered, converts each through its own ratio, and reverts unless the total clears <strong>minShares</strong>. Token units never enter the check. A token with a different ratio cannot masquerade as a better fill.</p>
<h3>The calldata is untrusted by construction</h3>
<p>Routing means executing somebody else's swap. We took the position early that we would never parse that calldata, because parsing it means trusting our parse of it.</p>
<p>A leg is five fields: <strong>target, data, tokenIn, maxIn, tokenOut</strong>. <a href="https://github.com/Adityaakr/parallax/blob/main/contracts/src/libraries/LegExecutor.sol" target="_blank" rel="noreferrer">LegExecutor</a> checks the target is on the registry allowlist, snapshots both balances, approves exactly <strong>maxIn</strong>, makes the call, resets the approval to zero, and then measures what moved. Nothing inside <strong>data</strong> is inspected. Only deltas count:</p>
<ul>
<li><p><strong>spent</strong> must be at most <strong>maxIn</strong>, or the leg reverts</p></li>
<li><p><strong>received</strong> must be greater than zero, or the leg reverts with LegNothingReceived</p></li>
</ul>
<p>That last rule does more work than it looks. A leg whose calldata sends the output to somebody else still pays out of our balance, but nothing arrives, so the whole transaction reverts. An attacker cannot use our approval to pay themselves without failing our own check.</p>
<h3>What it refuses</h3>
<p>Before any leg runs, the router rejects a target that is not allowlisted, a token that is not a registered representation of the underlying you asked for, and a representation that is not buy-eligible, which means paused by its issuer, deactivated, stale on its ratio, or backed by an <a href="https://github.com/Adityaakr/parallax/blob/main/contracts/src/StockRegistry.sol" target="_blank" rel="noreferrer">attestation</a> older than the freshness window. Selling has a deliberately weaker gate: any registered token can always be sold, even a deprecated or stale one, because an exit must never depend on data being fresh.</p>
<h3>Two things the audit sharpened</h3>
<p>A <a href="/blog/shipping-to-mainnet">twelve-agent audit round</a> found that both refund paths read the router's whole balance rather than the caller's own deposit. That was a real bug: tokens that reached the router by any other means would have been paid to whoever traded next. Refunds are now computed from what this caller sent in, <strong>usdtIn minus spent minus fee</strong>, and unsold tokens from <strong>tokenAmount minus sold</strong>.</p>
<p>The second fix was subtler. Every leg emits a <a href="/receipts">RouteReceipt</a> carrying the ratio and attestation timestamp at execution time, and that telemetry reads a live issuer view. If a token's ratio view ever reverted, the receipt would have taken the whole sell down with it, which contradicts our rule that exits never depend on freshness. That read now sits in a try/catch: a broken issuer degrades the receipt, never the trade.</p>
<h3>What this does not protect you from</h3>
<p>A share-denominated minimum bounds how many shares you receive. It says nothing about whether the price was fair, so the <a href="https://github.com/Adityaakr/parallax/blob/main/apps/resolver/src/scoring.ts" target="_blank" rel="noreferrer">resolver</a> layers a premium check against the Chainlink reference on top, and refuses to quote a representation trading too far above it. And the ratio itself is the issuer's claim about their own token. We bound how fast it can move and how stale it can get. We cannot make it true.</p>`,
    related: ["two-tokens-one-stock", "how-an-order-travels", "agent-mandates"],
  },
  {
    slug: "how-an-order-travels",
    category: "Architecture",
    title: "How an order travels, end to end",
    image: "cover-how-an-order-travels.png",
    date: "Sep 20, 2026",
    lede: "From a ticker in a text box to shares in your wallet: the six pieces that move an order, what each one is allowed to decide, and where a mainnet fork stops being able to tell you the truth.",
    pageTitle: "How an order travels, end to end",
    author: AUTHOR,
    body: `<h3>Six pieces, one direction.</h3>
<p>Parallax is a small system and it helps to see all of it at once. Nothing here holds your funds, and no component can decide anything the next one does not re-check.</p>
<figure class="diagram"><svg viewBox="0 0 640 430" role="img" aria-labelledby="archtitle archdesc" xmlns="http://www.w3.org/2000/svg">
<title id="archtitle">Parallax architecture</title>
<desc id="archdesc">Clients call the resolver, which scores every issuer against Binance, PancakeSwap and Chainlink data and returns an unsigned transaction. The user signs it; the contracts on BSC execute the legs and emit receipts, which an indexer links back to the scoring record. A keeper posts ratios, attestations and reference prices into the registry.</desc>
<defs><marker id="pxarrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--color-heading)"/></marker></defs>
<g font-family="var(--font-mono, ui-monospace)" font-size="11" fill="var(--color-heading)">
<rect x="8" y="14" width="150" height="96" rx="8" fill="none" stroke="var(--color-heading)" stroke-opacity=".35" stroke-dasharray="4 4"/>
<text x="20" y="34" font-size="10" fill="var(--color-brand)">CLIENTS</text>
<text x="20" y="56">Web app (wagmi)</text><text x="20" y="74">MCP client</text><text x="20" y="92">Agent Studio seller</text>
<rect x="8" y="150" width="150" height="96" rx="8" fill="none" stroke="var(--color-heading)" stroke-opacity=".35" stroke-dasharray="4 4"/>
<text x="20" y="170" font-size="10" fill="var(--color-brand)">MARKET DATA</text>
<text x="20" y="192">Binance Web3 API</text><text x="20" y="210">PancakeSwap v3</text><text x="20" y="228">Chainlink feeds</text>
<rect x="215" y="52" width="180" height="150" rx="8" fill="none" stroke="var(--color-heading)" stroke-opacity=".55"/>
<text x="230" y="74" font-size="10" fill="var(--color-brand)">RESOLVER</text>
<text x="230" y="98">1 &#183; score every issuer</text><text x="230" y="118">2 &#183; apply policy</text><text x="230" y="138">3 &#183; build legs</text><text x="230" y="158">4 &#183; simulate</text><text x="230" y="178">5 &#183; record the quote</text>
<rect x="452" y="90" width="180" height="76" rx="8" fill="none" stroke="var(--color-heading)" stroke-opacity=".35" stroke-dasharray="4 4"/>
<text x="466" y="112" font-size="10" fill="var(--color-brand)">THE USER SIGNS</text>
<text x="466" y="134">unsigned transaction,</text><text x="466" y="152">no custody anywhere</text>
<rect x="215" y="250" width="417" height="106" rx="8" fill="none" stroke="var(--color-heading)" stroke-opacity=".55"/>
<text x="230" y="272" font-size="10" fill="var(--color-brand)">BNB SMART CHAIN</text>
<text x="230" y="296">StockRegistry</text><text x="230" y="316">ShareRouter</text><text x="230" y="336">LegExecutor</text>
<text x="400" y="296">BasketVault &#215; 3</text><text x="400" y="316">BasketFactory</text><text x="400" y="336">AgentMandate</text>
<rect x="8" y="286" width="150" height="70" rx="8" fill="none" stroke="var(--color-heading)" stroke-opacity=".35" stroke-dasharray="4 4"/>
<text x="20" y="306" font-size="10" fill="var(--color-brand)">KEEPER</text>
<text x="20" y="328">ratios, prices,</text><text x="20" y="346">attestations</text>
<rect x="215" y="376" width="417" height="46" rx="8" fill="none" stroke="var(--color-heading)" stroke-opacity=".35" stroke-dasharray="4 4"/>
<text x="230" y="396">RouteReceipt &#8594; indexer, linked back to</text><text x="230" y="414">the scoring record by quote hash</text>
<path d="M158 62 L209 96" stroke="var(--color-heading)" stroke-opacity=".5" fill="none" marker-end="url(#pxarrow)"/>
<path d="M158 196 L209 168" stroke="var(--color-heading)" stroke-opacity=".5" fill="none" marker-end="url(#pxarrow)"/>
<path d="M395 128 L446 128" stroke="var(--color-heading)" stroke-opacity=".5" fill="none" marker-end="url(#pxarrow)"/>
<path d="M542 166 L542 244" stroke="var(--color-heading)" stroke-opacity=".5" fill="none" marker-end="url(#pxarrow)"/>
<path d="M158 318 L209 302" stroke="var(--color-heading)" stroke-opacity=".5" fill="none" marker-end="url(#pxarrow)"/>
<path d="M300 356 L300 370" stroke="var(--color-heading)" stroke-opacity=".5" fill="none" marker-end="url(#pxarrow)"/>
<path d="M215 399 L180 399 L180 130 L209 130" stroke="var(--color-brand)" stroke-opacity=".6" fill="none" stroke-dasharray="3 3" marker-end="url(#pxarrow)"/>
</g></svg><figcaption>Every arrow is code in this repository: clients call the resolver, the resolver scores and simulates, the user signs, the contracts execute and emit, the indexer closes the loop back to the scoring record.</figcaption></figure>
<h3>The resolver decides, the chain enforces</h3>
<p>Ask for $100 of <a href="/baskets/pxMAG7">pxMAG7</a> and the <a href="https://github.com/Adityaakr/parallax/blob/main/apps/resolver/src/baskets.ts" target="_blank" rel="noreferrer">resolver</a> does five things before you are shown anything to sign.</p>
<p><strong>It scores every issuer.</strong> For each constituent it works out the shares the vault still needs, then prices every eligible representation for exactly that amount, across each PancakeSwap v3 fee tier with a live pool and through the Binance aggregator. Each candidate is reduced to one number that can be compared: effective cost per underlying share.</p>
<p><strong>It applies <a href="https://github.com/Adityaakr/parallax/blob/main/apps/resolver/src/scoring.ts" target="_blank" rel="noreferrer">policy</a>.</strong> Candidates are dropped, with the reason recorded, for a stale attestation, a premium over the Chainlink reference beyond the cap, slippage beyond the cap, or no contract-executable liquidity. Ondo's RFQ route is the common case for that last one: it needs an EOA signature, so a contract cannot take it.</p>
<p><strong>It builds legs.</strong> Best candidate first, filling until the issuer cap for that constituent binds, then the next. Aggregator legs are then materialized with the vault itself as the taker, so the calldata that gets hashed is the calldata that gets sent.</p>
<p><strong>It simulates.</strong> The whole transaction is run against current state. A failing plan that used an aggregator route is re-planned with pools only rather than handed to you broken.</p>
<p><strong>It records the quote.</strong> Candidates, premiums, attestation ages and the policy that applied are written to a store and hashed. That hash rides along in the transaction, and the receipt the contract emits carries it back.</p>
<p>Then you sign. The <a href="https://github.com/Adityaakr/parallax/blob/main/contracts/src/BasketVault.sol" target="_blank" rel="noreferrer">vault</a> re-checks everything that matters onchain: every leg's target, every token's eligibility, the shares actually delivered per constituent, the backing invariant, the issuer caps. The resolver's opinion has no authority. It is a planner, and the chain is the judge.</p>
<h3>The aggregator leg, and what a fork cannot prove</h3>
<p>Routing through the Binance aggregator from a contract only works if the router pays <strong>msg.sender</strong> rather than an address baked into the calldata. We checked instead of assuming: <strong>buildSwapTransaction</strong> returns byte-identical calldata for an EOA taker and a contract taker, and the taker address appears nowhere in the payload.</p>
<p>On a <a href="https://github.com/Adityaakr/parallax/blob/main/contracts/test/fork/Mainnet.t.sol" target="_blank" rel="noreferrer">fork</a> pinned at head, a $200 NVDA leg through the allowlisted router credited <strong>0.900979 NVDA shares</strong> to ShareRouter for 452k gas, above the share minimum. An un-allowlisted target reverted with TargetNotAllowed, as it should.</p>
<p>What that run cannot prove is just as important. The aggregator picks its route per block. Routes through PMM and RFQ desks settle against signed off-chain orders that a forked chain cannot honour, so they revert inside the adapter even when they would fill on mainnet. The AMM path is proven; the desk path is provable only on mainnet. We also learned a fork's usefulness decays in hours rather than days: 6,286 blocks of staleness was enough to break a route that had executed cleanly at head.</p>
<h3>The keeper, and what it is allowed to do</h3>
<p>Some data cannot be read onchain. <a href="https://ondo.finance" target="_blank" rel="noreferrer">Ondo</a>'s ratios live in an API. Attestation dates live in issuer reports. Reference prices for names Chainlink does not cover have to come from somewhere. A <a href="https://github.com/Adityaakr/parallax/blob/main/apps/keeper/src/keeper.ts" target="_blank" rel="noreferrer">keeper</a> posts all of it, and everything it posts is bounded.</p>
<p>Ratio steps are capped against both the previous post and the value at the start of a rolling 24-hour window, so a run of individually legal small steps cannot compound into a large one. A jump beyond the bound is rejected and pauses buys for that representation until an admin confirms it, which is exactly what a stock split should do. Stale data blocks buys. It never blocks sells, and it can never block redeeming an index in kind.</p>
<h3>The same pipeline, three front doors</h3>
<p>The <a href="/baskets">web app</a>, the <a href="https://github.com/Adityaakr/parallax/blob/main/apps/mcp/src/server.ts" target="_blank" rel="noreferrer">MCP server</a> and the Agent Studio seller all call the same resolver and build the same unsigned transaction. An agent gets no privileged path, no separate contract, no faster lane. It gets the same plan a human would get, and then it has to pass through <a href="/blog/agent-mandates">a mandate the human wrote</a>.</p>`,
    related: ["slippage-in-shares", "backing-invariant", "agent-mandates"],
  },
  {
    slug: "backing-invariant",
    category: "Indices",
    title: "What an index unit actually is",
    image: "cover-backing-invariant.png",
    date: "Sep 19, 2026",
    lede: "A unit of pxMAG7 is a fixed number of shares of seven companies, provable onchain after every call. How the vault mints, redeems, migrates, and the one-wei bug a fuzzer found in its backing check.",
    pageTitle: "What an index unit actually is",
    author: AUTHOR,
    body: `<h3>An index is a fixed number of shares per constituent, or it is a promise.</h3>
<p>Most tokenized index products are a claim on a manager. You hold a token, the manager holds assets, and the relationship between them is policy. We wanted the relationship to be arithmetic.</p>
<p>A <a href="https://github.com/Adityaakr/parallax/blob/main/contracts/src/BasketVault.sol" target="_blank" rel="noreferrer">BasketVault</a> is defined at deployment by a list of constituents and, for each, a <strong>sharesPerUnit</strong> figure that never changes. One unit of <a href="/baskets/pxMAG7">pxMAG7</a> on BNB Smart Chain is 0.0644 NVDA plus 0.0425 AAPL plus 0.0289 MSFT plus 0.0561 AMZN plus 0.0407 GOOGL plus 0.0213 META plus 0.0391 TSLA. Not a target weight. Not a NAV claim. That many shares, or the call reverts.</p>
<h3>The invariant</h3>
<p>After every state-changing call, for every constituent, the vault must hold at least <strong>totalSupply &#215; sharesPerUnit</strong> in underlying shares, counted across every registered representation of that stock. Ondo tokens and bStocks tokens of the same name are fungible for this purpose once both are converted through their own ratios, which is what makes the vault able to buy whichever is cheaper without loosening what it owes.</p>
<p>That <a href="https://github.com/Adityaakr/parallax/blob/main/docs/invariants.md" target="_blank" rel="noreferrer">check</a> runs after minting, after migrating, and it is what makes the unit meaningful. Redemption cannot break it by construction, because a redemption removes at most the pro-rata slice.</p>
<h3>Four ways in and out</h3>
<p><strong>Mint.</strong> You supply the legs. The vault runs them, mints your units, and then requires that this call delivered every constituent's share of those units. Existing slack in the vault does not count. That rule came out of <a href="/blog/shipping-to-mainnet">the audit</a>: the aggregate backing check alone would have let someone mint against a cushion other holders had built, pay no fee, and skip the buy-eligibility gate with an empty leg list.</p>
<p><strong>Redeem.</strong> Your units burn, and you get the pro-rata slice of everything the vault holds. You choose how much of each slice to sell into USDT with legs; whatever you do not sell leaves in kind. A leg can never spend more than your own slice.</p>
<p><strong>Redeem in kind.</strong> Burn units, receive tokens. No oracle, no registry read, no pause, no freshness window, no fee. This is the escape hatch, and it is deliberately the dumbest function in the codebase. If an issuer freezes one of its tokens, <strong>redeemInKindSkipping</strong> lets you forfeit that slice and take the rest rather than being stuck behind it.</p>
<p><strong>Migrate.</strong> Anyone can move a constituent from one representation to another, and the vault accepts it only if the target's share count strictly increases, no other constituent decreases, and the vault's USDT does not fall. There is no way to call it that leaves the vault worse off, which is why it can be permissionless. On the mocks chain our keeper's migration bot moved a constituent at +288 bps of shares; on a fork it correctly refused a migration through a 1% pool that was not share-accretive at that block.</p>
<h3>Issuer caps, and the trap in the obvious version</h3>
<p>Concentration is its own risk, so a constituent can carry a cap: no single issuer above <strong>maxIssuerBps</strong> of that stock's shares. It only applies while at least two representations are buy-eligible, because forcing a split when only one issuer is available would just block minting.</p>
<p>The obvious implementation has a trap, and the audit caught it. If concentration builds up while one issuer is paused, the cap suddenly binds when the other comes back, and every mint reverts forever. The vault now judges a call on what it changed: a platform already over the cap may stay over it, as long as the call strictly dilutes its share. Mints and migrations that improve the picture go through, and the cap re-engages once it is satisfied.</p>
<h3>The bug a fuzzer found</h3>
<p>We generated a stateful <a href="https://github.com/Adityaakr/parallax/blob/main/contracts/PROPERTIES.md" target="_blank" rel="noreferrer">fuzz suite</a>: 93 properties, 270,136 calls, and it found something real.</p>
<p><strong>heldShares</strong> summed each representation's shares, each rounded down. <strong>requiredShares</strong> rounded up. After a pro-rata burn, those two roundings could leave a vault one or two wei short, which flipped <strong>backingOk()</strong> to false and made the next exactly-sized mint revert. No funds at risk, but a vault that could paint itself into a corner.</p>
<p>Backing is now compared exactly: the sum of balance times ratio, at 1e36 scale, against totalSupply times sharesPerUnit, with no rounding on either side. The failing sequence is a regression test.</p>
<h3>What this costs you, and what it does not</h3>
<p>Minting charges 0.5% of the USDT actually spent, capped at 1% in the contract and shown on every quote before you sign. Redeeming to USDT charges the same on the way out. <strong>Redeeming in kind is free</strong>, which is the part that matters: your exit never depends on anyone being paid.</p>
<p>The <a href="https://github.com/Adityaakr/parallax/blob/main/apps/resolver/src/baskets.ts" target="_blank" rel="noreferrer">minimum order</a> is set by liquidity rather than by us. The house floor is $5. It rises on an index holding a constituent whose only route is the aggregator's desk, because the desk will not fill a leg under $5.05 and that leg has to be large enough on its own. Today that means $36 on <a href="/baskets/pxMAG7">pxMAG7</a>, $51 on <a href="/baskets/pxAI">pxAI</a> and $100 on <a href="/baskets/pxNEW">pxNEW</a>. Lowering those needs liquidity for the Ondo tokens, not a smaller constant.</p>`,
    related: ["two-tokens-one-stock", "how-an-order-travels", "agent-mandates"],
  },
  {
    slug: "agent-mandates",
    category: "Agents",
    title: "An agent that cannot run away with your money",
    image: "cover-agent-mandates.png",
    date: "Sep 21, 2026",
    lede: "Caps, expiry, allowlists, a hardcoded recipient and a price floor, all enforced by a contract rather than by the agent's good intentions. Plus what the audit found in the first version.",
    pageTitle: "An agent that cannot run away with your money",
    author: AUTHOR,
    body: `<h3>The usual way to let an agent trade is to hope.</h3>
<p>You give a key an ERC-20 allowance, hand it to a process with an LLM in it, and rely on the prompt. Every guarantee lives off-chain, in the part of the system easiest to compromise and hardest to audit.</p>
<p>We wanted the opposite: the agent holds a key that can sign, and a contract that makes the worst case bounded and legible. <strong><a href="https://github.com/Adityaakr/parallax/blob/main/contracts/src/AgentMandate.sol" target="_blank" rel="noreferrer">AgentMandate</a></strong> is that contract.</p>
<h3>What the owner writes down</h3>
<p>The owner <a href="/mandates">creates a mandate</a> in one transaction, naming the agent's address and its limits. Per-transaction cap. Daily cap over a rolling window. Expiry. Which underlyings it may buy. Which index vaults it may mint. And the worst execution it may accept, in basis points below the reference price.</p>
<p>The rest is structural. <strong>The recipient is hardcoded to the owner</strong>, so no parameter the agent supplies can redirect the output. USDT is pulled from the owner per trade under their own approval, never pre-funded into the agent. Revocation is one transaction and takes effect immediately.</p>
<p>The agent can spend within those numbers. It cannot exceed them, cannot extend them, cannot pay itself, and cannot touch anything the owner did not allowlist.</p>
<h3>Two holes the audit found</h3>
<p>The first version got the custody right and the economics wrong.</p>
<p><strong>The agent chose its own slippage.</strong> It supplied both the swap calldata and the minimum share count, so it could pass <strong>minShares = 1</strong> with a leg that routed 99% of the output elsewhere, and the contract would have been satisfied: the recipient was still technically the owner. The caps bounded how much USDT could move, not what had to come back.</p>
<p>The fix is a floor the owner sets, not the agent. After the trade, the contract measures what actually left the owner's wallet, fee included, and requires that it bought at least <strong>spent &#215; (1 - maxSlippageBps) / referencePrice</strong> in shares, or the equivalent value in index units. Reference prices come from <a href="https://docs.chain.link/data-feeds/price-feeds/addresses?network=bnb-chain" target="_blank" rel="noreferrer">Chainlink feeds</a> on mainnet for the Mag 7 and from bounded keeper posts elsewhere. A missing or stale price blocks agent buys only. It never blocks the owner's own trades or exits.</p>
<p><strong>Settlement read the wrong balance.</strong> The refund logic looked at the contract's total USDT balance rather than the delta for this call. Since one AgentMandate serves every owner, a stray balance would have been swept to whoever traded next, and the spend recorded against their daily cap would have been zero. It now snapshots before pulling and settles on the difference, capped at the authorized amount.</p>
<h3>The stack above it</h3>
<p>Three agent surfaces sit on top, and none of them gets a privileged path.</p>
<p><strong>An <a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer">MCP</a> <a href="https://github.com/Adityaakr/parallax/blob/main/apps/mcp/src/server.ts" target="_blank" rel="noreferrer">server</a></strong> exposes fifteen tools to any MCP client: search stocks, resolve a stock to the best issuer, list and quote indices, read a mandate, build the transaction that creates one, read and explain receipts. Fourteen are read-only. The single write tool is <strong>execute_with_mandate</strong>, it signs with the configured agent key, it can only reach the chain through AgentMandate, and it simulates before it sends.</p>
<p><strong>A <a href="https://www.npmjs.com/package/@bnbagent/studio-cli" target="_blank" rel="noreferrer">BNB Agent Studio</a> seller</strong> gives the agent an identity and a way to be paid. It registers under <a href="https://eips.ethereum.org/EIPS/eip-8004" target="_blank" rel="noreferrer">ERC-8004</a>, serves an A2A agent card, an MCP face and an x402 face from one runtime, and takes escrowed jobs over <a href="https://eips.ethereum.org/EIPS/eip-8183" target="_blank" rel="noreferrer">ERC-8183</a>. Signing is fixed handler code, never a tool the model can call. When a funded job or a paid request names an index, a dollar amount and a mandate id, that <a href="https://github.com/Adityaakr/parallax/blob/main/agent/app/agent/src/parallax/work.ts" target="_blank" rel="noreferrer">fixed code</a> plans the investment through the resolver, re-checks it against the mandate, signs and broadcasts. Anything ambiguous is answered as research, and nothing moves.</p>
<p><strong>The <a href="https://www.npmjs.com/package/@binance/agentic-wallet" target="_blank" rel="noreferrer">Binance Agentic Wallet</a></strong> is the execution layer on mainnet. Paired to a real wallet, it quotes its own route per issuer, which is a genuinely independent check on ours, and it carries our calldata through a preview-then-execute flow with Binance's simulation and risk parse in front. On a $100 NVDA comparison it picked NVDAB at $220.60 a share against NVDAon at $221.25, the same fill our resolver chose.</p>
<h3>Recorded, not described</h3>
<p>Everything above ran end to end on BSC testnet before we wrote about it. Over the x402 face, "Invest $50 into pxMAG7 with mandate 1" produced 0.5011 units across seven legs. Over ERC-8183, a buyer negotiated a signed quote, funded job 1276, and the seller executed the investment and submitted the deliverable. After both runs the agent wallet held zero units and zero USDT, the owner held the units, and mandate 1's remaining daily allowance had fallen by exactly what was spent.</p>
<p>One lesson worth passing on: a Studio seller's work function is retried by the runtime's sweep. If the work moves money, it has to be idempotent per job id or it executes twice. We found that the expensive way, and executions are now recorded against their job id before anything is signed.</p>
<h3>What this does not do</h3>
<p>The agent key is hot. A mandate bounds the damage a compromised key can do to a cap, a window, an allowlist and a price floor. It does not make a bad trade inside those bounds impossible, and it is not a substitute for revoking a key you no longer trust. The Agentic Wallet has no BSC testnet support, so that part of the stack is mainnet-only by its own design. And the admin role on the <a href="https://github.com/Adityaakr/parallax/blob/main/contracts/src/StockRegistry.sol" target="_blank" rel="noreferrer">registry</a> is still a deployer EOA rather than a multisig, which we say plainly <a href="/about">in the app</a> rather than in a footnote.</p>`,
    related: ["backing-invariant", "slippage-in-shares", "shipping-to-mainnet"],
  },
  {
    slug: "shipping-to-mainnet",
    category: "Operations",
    title: "Shipping to mainnet: the audit, the cost, the limits",
    image: "cover-shipping-to-mainnet.png",
    date: "Sep 22, 2026",
    lede: "Twelve audit agents, six findings, a fuzz campaign that caught a one-wei bug, and 0.00183 BNB to put the whole system on chain 56. What is live, and what we are still honest about.",
    pageTitle: "Shipping to mainnet: the audit, the cost, the limits",
    author: AUTHOR,
    body: `<h3>Contracts are immutable, so the order matters.</h3>
<p>We had a working system on testnet and a deadline. The temptation was to deploy and keep building. We audited first, because a deploy is the one step you cannot take back, and a bug found on 23 September in a contract deployed on 22 September is a migration rather than a commit.</p>
<h3>The audit</h3>
<p>Twelve specialized agents went at the contracts in parallel: conservation, access control, economic security, execution traces, invariants, periphery, first principles, asymmetry, boundaries, and three gap hunters looking at the seams between those lenses. Their findings were deduplicated by contract, function and bug class, then gated on whether the attack actually executes end to end.</p>
<p>Six survived. All six were fixed the same day, each has a test, and each is written up in <a href="https://github.com/Adityaakr/parallax/blob/main/docs/decisions.md" target="_blank" rel="noreferrer">the decision log</a>.</p>
<ul>
<li><p><strong>Mint could draw on other holders' slack.</strong> The aggregate backing check let someone mint units against a cushion the vault already had, fee-free and past the eligibility gate with no legs at all. Now every constituent must be delivered by that call.</p></li>
<li><p><strong>An agent could divert its owner's output.</strong> Fixed with the owner-set execution floor described in <a href="/blog/agent-mandates">the mandate write-up</a>.</p></li>
<li><p><strong>Settlement read absolute balances</strong> in the mandate, and both refund paths did the same in the router. All three now settle on deltas scoped to the call.</p></li>
<li><p><strong>The issuer cap could brick a vault</strong> once a paused issuer came back. Now an over-cap platform can always be diluted.</p></li>
</ul>
<p>Then we generated a stateful <a href="https://github.com/Adityaakr/parallax/blob/main/contracts/PROPERTIES.md" target="_blank" rel="noreferrer">fuzz suite</a> and ran it: 93 properties over 270,136 calls, with 96 to 100% line coverage on the core contracts. It found one more, and a real one. Summing each representation's shares rounded down, against a requirement rounded up, could leave a vault one wei under-backed after a pro-rata burn, so the next exactly-sized mint reverted. Backing is now compared exactly at 1e36 scale, and the fuzzer's own failing sequence is a regression test.</p>
<p>The suite that ships is 124 Foundry tests, including six against a mainnet fork, plus the fuzz campaign. Every revert path has a test. We do not call any of that an audit by a firm, and the app says so where someone might assume otherwise.</p>
<h3>The deploy</h3>
<p>Five broadcasts, 41,034,465 gas, <strong>0.00183 BNB</strong> paid at around 0.045 gwei. That is the whole system: registry, router, factory, agent mandate and three index vaults.</p>
<ul>
<li><p>StockRegistry <a href="https://bscscan.com/address/0x84Af7451794aaDFa729d6e8e140B51169a6cfe7D" target="_blank" rel="noreferrer"><strong>0x84Af7451794aaDFa729d6e8e140B51169a6cfe7D</strong></a></p></li>
<li><p>ShareRouter <a href="https://bscscan.com/address/0xcfAa542E4Dac083E440644EDF6C54f8d78B0579C" target="_blank" rel="noreferrer"><strong>0xcfAa542E4Dac083E440644EDF6C54f8d78B0579C</strong></a></p></li>
<li><p>BasketFactory <a href="https://bscscan.com/address/0xcE3BEdD849f25f2E11ab1882C65596b56620CcBB" target="_blank" rel="noreferrer"><strong>0xcE3BEdD849f25f2E11ab1882C65596b56620CcBB</strong></a>, AgentMandate <a href="https://bscscan.com/address/0xAa0e98479e43189E777699aAE498716988333CcB" target="_blank" rel="noreferrer"><strong>0xAa0e98479e43189E777699aAE498716988333CcB</strong></a></p></li>
<li><p>pxMAG7 <a href="https://bscscan.com/address/0x38bf68E3B60C95eefE24325823679DbaA1E99728" target="_blank" rel="noreferrer"><strong>0x38bf68E3B60C95eefE24325823679DbaA1E99728</strong></a>, plus <a href="/baskets">pxAI and pxNEW</a></p></li>
</ul>
<p>The <a href="https://github.com/Adityaakr/parallax/blob/main/contracts/deployments/56.json" target="_blank" rel="noreferrer">registry</a> holds the 19 stocks the three indices need and their 36 Ondo and bStocks tokens, with Chainlink USD feeds wired for the Mag 7 and the protocol fee set to 50 bps. The catalogue behind it carries 42 stocks; the rest are configuration away, because the registry is additive.</p>
<p>Minutes after deploying, a $100 pxMAG7 quote filled all seven legs: five through PancakeSwap pools, two through the aggregator's desk.</p>
<h3>What deploying taught us about the product</h3>
<p>Two things only became true on mainnet.</p>
<p>The first is that <strong>the minimum order size is not ours to choose</strong>. We had shipped a $5-per-constituent rule of thumb. Mainnet showed the real shape: a $1 mint cannot source Apple or Amazon, because on BSC they exist only as Ondo tokens with no usable pool, and the desk that is their only route <a href="https://github.com/Adityaakr/parallax/blob/main/scripts/probe-desk.mts" target="_blank" rel="noreferrer">refuses legs at or below $5.00</a>. The floor is now derived from venue liquidity per index, which is why pxMAG7 asks $36 and pxNEW asks $100.</p>
<p>The second is that <strong>price history is unevenly available</strong>. Chainlink covers the Mag 7 on BSC and nothing else, so pxNEW had no returns at all. We checked what actually exists rather than shipping five dashes: PancakeSwap v3 pools keep their own <a href="https://github.com/Adityaakr/parallax/blob/main/scripts/probe-twap.mts" target="_blank" rel="noreferrer">TWAP oracle</a>, which reaches days back on a busy pool, and the underlying's daily closes reach two years. Each period on each index now uses whichever single source can price both of its ends, with the share of NAV it covers printed next to the number.</p>
<h3>What we are still honest about</h3>
<p>The admin role is a deployer EOA, not a multisig behind a timelock. The keeper is a hot key, bounded by step limits and freshness windows, with in-kind redemption as the escape hatch if it goes wrong. Issuers can pause or blocklist their own tokens, which freezes that representation inside a vault while everything else keeps working. Source verification on BscScan is still pending an API key. And no one has minted on mainnet yet, because the deployer wallet has 0.00087 BNB left and that is a funding problem rather than a technical one.</p>
<p>Every one of those is <a href="/about">in the app</a>, next to the thing it affects. A system that tells you where it is weak is easier to trust than one that does not mention it.</p>`,
    related: ["backing-invariant", "agent-mandates", "how-an-order-travels"],
  },
];
