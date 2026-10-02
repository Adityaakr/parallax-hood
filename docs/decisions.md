# Decisions

Parallax was built for BNB Chain and ported to Robinhood Chain for the Arbitrum Open House Singapore buildathon.
This log records every choice in the port that is not obvious from the code, with the date and the reason. The
facts each decision rests on are in `docs/addresses.md`.

## 2026-10-02: the port

### D1. USDG is the quote asset, and its 6 decimals are handled explicitly

USDG on Robinhood Chain reports `decimals() = 6`; USDT on BNB Chain had 18, and the code assumed a quote amount
was already a 1e18 USD value. Three options: wrap USDG in an 18-decimal adapter, scale amounts at every boundary,
or scale only where a USDG amount meets a USD price.

Chosen: the last. Transfers, caps, fees and refunds are in raw USDG and needed no change. The one place a quote
amount is compared with a 1e18 price on chain is `AgentMandate`'s floor, which now multiplies by `quoteScale =
10^(18 - decimals)`, read from the token at construction. Off chain the SDK has `usdgToWad` and `wadToUsdg`, and
the resolver converts in scoring and nowhere else. A wrapper would have added a contract that holds user funds
for the sake of arithmetic.

USDG is taken at one dollar, as USDT was. Chainlink has a USDG / USD feed and it is not consulted: a depeg would
make the mandate's floor too loose or too tight by the size of the depeg, which the owner's `maxSlippageBps`
bounds. Recorded as a known limit in the threat model.

### D2. The reference price is per share, so token-denominated feeds are divided by the multiplier

Robinhood's stock feeds price the token with the ERC-8056 multiplier included. The registry's `referencePrice`
is defined as USD per underlying share and the mandate's floor depends on that. `setTokenPriceFeed(underlying,
feed, token)` records the token a feed prices and `referencePrice` divides by its live ratio. `setPriceFeed`
keeps its per-share meaning for any feed that prices the underlying itself.

Today the difference is under 10 basis points (NVDA's multiplier is 1.000775). After a two-for-one split the
multiplier doubles, and a floor computed without the division would be off by half.

### D3. No keeper. A read-only monitor instead

On BNB Chain one issuer's share ratio existed only behind an API, so a keeper posted ratios, attestation
timestamps and market state, and every freshness window was a liveness dependency on it. Here the ratio is the
token's own `uiMultiplier()` and the price is a Chainlink feed, so nothing needs posting. `apps/keeper` is
removed and `apps/monitor` replaces it: no key, no transactions, it reports the conditions that need a person
(a stopped feed, a multiplier past the step bound, a scheduled multiplier change, an issuer pause, thin pools, a
failed backing check).

`KEEPER_ROLE` remains in `StockRegistry` and is held by the admin. It is what checkpoints a multiplier
(`checkpointRatio`) and posts a price where there is no feed, which the mock networks use.

### D4. The attestation gate is off

`isBuyEligible` requires a fresh platform attestation. Robinhood publishes none that a contract can read, and a
gate that only a keeper's timestamp can open is a liveness risk that buys nothing. `ConfigureRegistry` sets
`maxAttestationAge` to the largest `uint64`, which disables the check without changing the contract; the code
path stays for an issuer that does publish one. What stands in its place is on chain: the multiplier must be
within `maxRatioStepBps` (5 %) of its last checkpoint, so a split pauses buys of that token until the admin
confirms the new ratio.

### D5. The price window is five days

Chainlink's stock feeds stop from Friday 20:00 to Sunday 20:00 New York time and for a further day on a market
holiday. The longest gap between two answers on any stock feed since launch is 95.98 hours. A window shorter than
that would switch agent buys off over every holiday weekend, so `maxPriceAge` is 5 days. A stale price blocks
agent buys only. The cost: over a weekend the floor is computed from Friday's price while pools keep trading.
The resolver applies the tighter closed-market premium cap in that window, and the owner's `maxSlippageBps`
bounds the rest.

### D6. One venue: Uniswap v3 through SwapRouter02

A leg approves a target, calls it and is judged by balance deltas. SwapRouter02 fits that with a recipient
argument and nothing else on the allowlist. Uniswap v4 is deeper for some stocks but swaps through the
UniversalRouter and Permit2, which does not fit approve-then-call, and Uniswap's own sources disagree on the
UniversalRouter address for this chain. The aggregators need API-built calldata that was not simulated end to
end. Each is listed in `docs/addresses.md` section 6. Routing still picks the best price per share across what
it has: every fee tier, and two hops through WETH, which beats the direct pool for NVDA at most sizes.

### D7. The testnet deployment runs on mocks, and says so

Robinhood Chain Testnet has no Uniswap and no Chainlink feeds, and five of the seven stocks do not exist there.
The testnet deployment therefore uses `MockStockToken`, `MockUSDG` (6 decimals) and `MockSwapTarget`, priced
once from the mainnet Chainlink answers when `mocks.json` was generated. Real testnet USDG exists but the faucet
gives about 100 a day, not enough to fund a venue's sell side. The resolver's `/health` returns a `label` naming
the network and listing what is mocked, the MCP server's `get_network` returns the same, and the app shows it on
every screen. The real tokens, feeds and pools are exercised by the fork test instead.

### D8. A supply cap on vault mints

The contracts are unaudited. `StockRegistry.setSupplyCap(basket, units)` lets the admin bound a vault's
outstanding units and `BasketVault.mint` checks it. It is checked on mint only: lowering it below the supply
stops new units and never blocks a redemption, so invariant 2 is untouched.

### D9. Multi-representation support is kept

Robinhood Chain has one issuer per stock. The registry, the vault's issuer caps and the migrate path still
handle several representations per underlying and are covered by the unit, fuzz and invariant suites with two
mock issuers. Removing them would have been a larger and riskier change than keeping them, and a second issuer
on this chain would need no contract change.

### D10. What "redeem in kind always works" means here

No pause, oracle or freshness window that Parallax controls can block `redeemInKind`. The issuer can: Robinhood
can pause a token or block an address, and Paxos can pause USDG or freeze an address. A paused token cannot leave
the vault until the issuer lifts the pause; the other constituents still can, through `redeemInKindSkipping`. This
is stated in the README and the threat model rather than claimed away.

### D11. Local dev ports

Resolver 4100, MCP 4110, monitor 4120, web 3200, fork anvil 8647, mocks anvil 8648. The BNB Chain build uses
4000, 4010, 4020, 3100, 8547 and 8548 on the same machine and both stacks have to run side by side.

### D12. The BNB Agent Studio seller is not ported

`agent/` sold Parallax as a paid service through BNB Chain's ERC-8183 and x402 rails. Neither exists on
Robinhood Chain. The agent path here is the MCP server acting through `AgentMandate`.

## Status

| Date | State |
|---|---|
| 2026-10-02 | Contracts, SDK, quoting client, resolver, MCP server and monitor ported. 139 Foundry tests, fork test against chain 4663, resolver and MCP end-to-end tests on the local chain. Not deployed to the testnet or mainnet yet. |
