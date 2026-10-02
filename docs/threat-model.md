# Threat model

What can go wrong on Robinhood Chain, who can cause it, what bounds the damage and what does not. Trust
assumptions are stated as they are; nothing here claims a protection that was not built. Facts about the chain,
the tokens, USDG, the feeds and the venue are from `docs/addresses.md`; the reasons behind each design choice
are in `docs/decisions.md` (D1 to D12); the tests named here are listed with their files in
`docs/invariants.md`.

## Actors and trust

| Actor | Power | Trust today | Production recommendation |
|---|---|---|---|
| **ADMIN** (`DEFAULT_ADMIN_ROLE` on `StockRegistry` and `BasketFactory`) | register underlyings and tokens, deprecate a token, allowlist swap targets, set the fee (hard cap 1 %) and its recipient, set freshness windows and step bounds, set and clear price feeds, confirm a ratio after a corporate action, set supply caps, create vaults, grant and revoke roles | One deployer key. Fully trusted. | Multisig and timelock; allowlist changes, `addRepresentation`, feed changes and `confirmRatio` behind the timelock. |
| **KEEPER_ROLE** | `checkpointRatio` (bounded), `postReferencePrice` (bounded, ignored while a feed is set), `postRatio` for a posted-ratio token (none on this chain), `postAttestation`, `postMarketState` | Held by the admin key unless `KEEPER_ADDRESS` is set at deploy. No process uses it in steady state (D3). | Keep it with the admin multisig, or a separate key used only for checkpoints. |
| **GUARDIAN_ROLE** | pause and unpause buys | The admin key. | A separate key held by whoever is on call. |
| **Robinhood** (stock token issuer) | pause one token or all, block an address, burn from any address, change the multiplier, upgrade every token through one beacon with a single key and no timelock | External. Cannot be mitigated on chain. | None available: there is one issuer per stock, so issuer caps cannot diversify. |
| **Paxos** (USDG issuer) | pause USDG, freeze an address, upgrade the token | External. | None on chain. |
| **Chainlink** | publishes the feeds the reference price is read from | External. Affects agent buys and display only. | Cross-check against a second source before relying on the floor for large mandates. |
| **Uniswap v3 SwapRouter02** | receives an approval for exactly one leg's `maxIn`, for the duration of the call | Third-party code. The only address the deploy configuration allowlists. | Keep the allowlist at one entry; add venues behind the timelock. |
| **Sequencer** | orders transactions, can delay or exclude them | External. | None on chain. |
| **Users and agents** | call public functions with arbitrary legs | Untrusted. | |
| **Resolver, MCP server, web app** | build quotes, legs and unsigned transactions; the MCP server holds the agent key | Off chain. Not trusted by the contracts. Trusted by whoever signs what they return. | Run your own; keys in the environment; check the target and the bounds before signing. |

The contracts are not upgradeable and have no owner functions of their own: `ShareRouter`, `BasketVault` and
`AgentMandate` have no role-gated function. Everything privileged goes through `StockRegistry` and
`BasketFactory`.

## Threats

### T1. A malicious or wrong leg

*Who:* any caller, a compromised resolver, a venue that misbehaves.

*What:* calldata that pulls more than expected, pays a different recipient, swaps into the wrong token or
reenters.

*Bounds:* the target must be on the registry's allowlist, which the deploy configuration fills with
SwapRouter02 only (D6). The approval is set to `maxIn` for `tokenIn` only and reset to zero after the call. The
result is measured by balance deltas on the executing contract, and a leg that delivers nothing reverts. On a
buy or a mint `tokenOut` must be a buy-eligible representation of the requested underlying or of a constituent;
on a sell or a redeem it must be USDG; on a migration both sides must stay inside the migrated constituent.
`minShares`, `maxUsdgIn`, `minUsdgOut` and `minShareGain` bound the outcome. Every entry point is
`nonReentrant`. A leg therefore cannot take more than `maxIn` and cannot leave an approval behind.

*Residual:* a leg can be a bad trade inside the caller's own bound. That is the caller's choice. For vaults the
invariants keep the harm with the caller: a mint must deliver its own backing, a redeem can sell only the
redeemer's slice, a migration must raise the vault's shares.

*Tests:* L1 to L4 in `docs/invariants.md`; `test_buyShares_adversarialVenues`, `testFuzz_adversarial_modes`,
`test_agent_cannotRedirectRecipient`; on real pools `test_buySharesThroughUniswap_thenSell` checks the allowance
is zero after the leg.

### T2. The holder of `KEEPER_ROLE`

*What it can do on this chain:* with every token on its own multiplier and every stock on a feed, nothing it
posts changes a ratio or a price in use. `checkpointRatio` can only store the token's live multiplier, and only
if that is within `maxRatioStepBps` (5 %) of the previous checkpoint and of the checkpoint at the start of the
current day. `postReferencePrice` is ignored while a feed is set. `postAttestation` has no effect on eligibility
while the attestation gate is off (D4). `postMarketState` is informational.

*Residual:* it can keep the checkpoint following a multiplier that drifts in small steps, which is its purpose.
It cannot re-anchor across a split; that needs the admin's `confirmRatio`.

*Tests:* `test_postRatio_rejectsLargeStep`, `test_postRatio_stepIsAnchoredOverWindow`,
`test_checkpointRatio_erc8056`, `test_referencePrice_keeperPostedAndBounded`.

### T3. Chainlink feeds

The reference price is read by `AgentMandate` for its floor and by the resolver for display and policy. It does
not touch backing, minting, redemption or an owner's own trade.

- **The feed prices the token, not a share.** Handled: `setTokenPriceFeed` records the token and
  `referencePrice` divides by its live multiplier (D2). `test_referencePrice_tokenFeed_isPerShare`,
  `test_referencePriceIsPerShare` on the fork.
- **The feeds stop over weekends and market holidays.** They publish nothing, not even a heartbeat, from Friday
  20:00 to Sunday 20:00 New York time and for a further day on a holiday. `maxPriceAge` is 5 days so that a
  holiday weekend does not switch agent buys off (D5). The cost: for up to that long the floor is computed from
  the last print while the pools keep trading. If the market has fallen since the print, the floor is too low by
  the size of the move. The resolver applies a tighter premium cap while its computed schedule says closed (50
  bps instead of 100 by default) and by default builds no transaction then. That schedule is computed and does
  not know exchange holidays, so on a holiday it applies the open-market cap to a stale price.
- **A bad print.** The floor guards only the minimum. A print that is too low lets an agent's trade through at
  a worse price than the owner intended, by the size of the error on top of `maxSlippageBps`. A print that is
  too high makes fair agent buys revert. The registry treats a non-positive answer as missing. It does not
  cross-check the answer against a second source. The first rounds of each feed in June 2026 were published
  1e10 too large; the resolver's history drops them, and the registry reads only the latest round.
- **No sequencer uptime feed.** Chainlink lists none for this chain, so the contracts cannot tell a fresh price
  from one that looks fresh because the sequencer was down. The only check is the answer's age.
- **A stopped feed.** Beyond `maxPriceAge` agent buys of that stock revert with `StaleReferencePrice`
  (`test_agentBuy_blockedByStaleReferencePrice`). Nothing else is affected. The monitor reports a feed in the
  last fifth of its window as a warning and beyond it as critical.

What bounds all of these: the owner's `maxSlippageBps`, the per-transaction and daily caps, and the fact that
whatever is bought goes to the owner.

### T4. A compromised or mistaken ADMIN

*Cannot:* no admin function transfers tokens out of the router, a vault, the mandate contract or a wallet. No
pause, freshness window, step bound, supply cap or fee setting is read by `redeemInKind`
(`test_redeemInKind_worksWhenEverythingIsStaleOrPaused`, `test_supplyCap_boundsMintsOnly`). The fee cannot
exceed 1 % (`test_setFee_onlyAdminAndCapped`) and is never charged on an in-kind exit. Deprecating a token
never blocks a sale or a redemption.

*Can, and this is the main trust assumption:*

- **Register a false representation.** A token the admin controls, registered under a real underlying with an
  inflated ratio, counts as many shares. Units can then be minted against it and redeemed for a pro-rata slice
  of the real tokens, or real tokens can be migrated into it. The resolver would also rank it first, since it
  ranks by shares per dollar. This takes value from vault holders and misroutes buyers.
- **Block a vault.** Every vault call, including `redeemInKind` and `redeemInKindSkipping`, first reads
  `balanceOf` on every registered representation of every constituent. A registered token whose `balanceOf`
  reverts would make all of them revert, and there is no function that removes a representation. So "redeem in
  kind always works" holds against every parameter the admin can set and does not hold against a hostile
  `addRepresentation`. Not covered by a test.
- **Allowlist a hostile swap target.** On its own this harms only a caller who routes through it; the vault's
  invariants still apply to every call.
- **Point a feed at the wrong contract.** A price that reads too low removes the mandate floor's protection; a
  price that reads too high, or a zero address with nothing posted, blocks agent buys.
- **Loosen the guards.** `setLimits` accepts a step bound up to 100 %, which would let a two-for-one split
  through without a pause; `setPriceLimits` accepts any price window.
- **Confirm a wrong ratio.** For an ERC-8056 token `confirmRatio` cannot change the ratio in use, which is read
  from the token. It re-anchors the guard, so it can reopen buys after a split.
- **Stop new business.** Deprecate tokens, pause buys, set a supply cap below the supply.

*Mitigation:* multisig and timelock in production. Every one of these actions emits an event.

### T5. Stale data and liveness

There is no keeper, so the only things that go stale are:

- **A feed** older than 5 days: agent buys of that stock stop (T3).
- **A multiplier that drifts past the step bound.** Dividends raise the multiplier a little at a time. If the
  live value ends up more than 5 % from the registry's checkpoint, buys of that token pause, and since
  `checkpointRatio` is itself bounded by the same step, only the admin's `confirmRatio` reopens them. Someone has
  to checkpoint before that point. The monitor warns at half the bound. This is a liveness dependency on the
  admin key, for buys only.
- **A scheduled multiplier change** (`newUIMultiplier()`, `effectiveAt()`). The resolver shows it and the
  monitor reports it; nothing on chain acts on it before it takes effect.

In every case sells, USDG redemptions and in-kind redemptions continue, and the resolver excludes the affected
token with a reason string.

### T6. The issuer: Robinhood

From the tokens' verified source and live calls (`docs/addresses.md`, section 3): the issuer can pause one token
or all of them, block an address (as sender, recipient or caller), burn from any address, and replace the
implementation of every token through one beacon with a single key and no timelock. The multiplier is the
issuer's to set; nothing on chain prevents it from going down.

*Consequences, and what the contracts do about each:*

- **A paused token** cannot move. It cannot be bought, sold, minted with or delivered. Plain `redeemInKind`
  reverts while the vault holds any of it. `redeemInKindSkipping` lets a holder leave with every other token;
  the holder gives up the skipped slice, which stays in the vault for those who remain
  (`test_redeemInKind_skipFrozenToken`). If the issuer pauses all seven tokens at once, skipping all of them
  returns only the vault's USDG share, which is normally zero. In that case the realistic choice is to wait.
- **A blocked address.** If a vault is blocked for a token, that token is frozen in that vault, as above. If the
  router is blocked, buys and sells of that token revert; the router holds nothing between calls, so no funds
  are stuck. If SwapRouter02 or a pool is blocked, legs through it revert. A blocked holder can name another
  `recipient`.
- **A burn from the vault** lowers held shares below what the supply requires. `backingOk()` turns false, mints
  revert with `BackingViolated`, and the holders share the loss pro rata when they redeem. The contracts cannot
  prevent this. The monitor reports it as critical.
- **A multiplier decrease** has the same effect on held shares. Within 5 % of the checkpoint, buys stay open and
  a mint reverts only if backing is short. Beyond 5 %, buys of that token pause until the admin confirms
  (`test_corporateAction_pausesBuysUntilAdminConfirms`).
- **A split** raises the multiplier past the bound and pauses buys the same way. A vault's `sharesPerUnit` is
  fixed at construction and nothing rescales it. After a two-for-one split the vault holds about twice the shares
  its supply requires for that stock, and once the admin confirms the new ratio a new mint delivers the old share
  count, now worth half, and takes a pro-rata claim on the surplus. That dilutes earlier holders. The same
  mechanism at dividend scale is the documented behaviour that surplus accrues to all holders, later minters
  included. The available response is manual: stop mints into the old vault with `setSupplyCap` (which never
  blocks an exit) and create a new vault with rescaled units. Not covered by a test.
- **An upgrade** can make a token do anything. If it made `balanceOf` revert, every call on a vault holding that
  token would revert, in-kind exits included, for the reason given in T4. The monitor does not watch the beacon.
- **No diversification.** There is one issuer per stock, and pxMAG7 and pxAI are configured with
  `maxIssuerBps = 10000`. The issuer-cap and migration code is kept for a second issuer (D9) and protects
  nothing today.

*What the monitor flags:* `paused()` on a token (critical), the token's `oraclePaused()` flag (warning), a
multiplier past the bound (critical) or past half of it (warning), a scheduled multiplier change (notice), and a
failed backing check (critical). It does not check blocklists or the beacon.

### T7. The sequencer and ordering

Robinhood Chain's sequencer orders transactions first come, first served and excludes transactions tied to
sanctioned addresses. It can therefore delay or refuse a transaction, including an exit, and the contracts have
no way around it. Ordering around a trade is bounded by the caller's own limits: `minShares` (in shares),
`maxUsdgIn`, `minUsdgOut`, `minShareGain`. The resolver's default tolerance is 50 bps and it simulates before it
returns a transaction.

`block.number` on this chain is an estimate of the L1 block number. No contract in `contracts/src` reads it;
every window (ratio step, price age, mandate day, expiry) uses `block.timestamp`.

### T8. Reentrancy

Every external state-changing function on the router, the vault and the mandate is `nonReentrant`. Tested with
a venue that calls back into the caller (`test_buyShares_adversarialVenues`, `test_reentrancy_blocked`).

### T9. Approval leftovers

`forceApprove(maxIn)` then `forceApprove(0)` around every leg. The mandate approves the router or the vault for
exactly the authorized amount and resets it to zero. `testFuzz_normal_deltasMatch` asserts a zero allowance
after execution; the fork test asserts it against SwapRouter02; harness properties GL-30 and SP-06 check it
after every call.

### T10. Rounding

Shares credited round down (`sharesForTokens`). Tokens required round up (`tokensForShares`,
`requiredShares`). Pro-rata payouts round down. The backing comparison itself is exact at 1e36 scale. Dust stays
in the vault and cannot create a deficit. Fuzzed in `fuzz/ShareMath.t.sol`. USDG's 6 decimals mean a USDG amount
floors at one millionth of a dollar; `unit/UsdgQuote.t.sol` pins the conversions.

### T11. A compromised agent key

*Can:* call `agentBuyShares` and `agentMintBasket` on every mandate that names the key, until the owner revokes
or the mandate expires. Spend up to `perTxCapUsdg` per call and `dailyCapUsdg` per 24 hours of the owner's USDG,
on the underlyings and vaults the owner allowlisted. Choose the route and the timing, including a weekend when
the floor is computed from Friday's price (T3). Write the leg calldata, so execute badly on purpose or direct
part of a swap's output elsewhere, as long as the owner still receives the floor.

*Cannot:* receive the router's or the vault's output, which goes to the owner. Exceed either cap. Act on an
underlying or vault that is not allowlisted, after expiry or after revocation. Sell, transfer or withdraw
anything the owner holds. Change the mandate. Touch another owner's funds.

*Worst case:* per call the owner receives at least `spent × (1 - maxSlippageBps / 10000)` worth of shares at the
reference price. So the most that can be wasted or diverted in a day is `dailyCapUsdg × maxSlippageBps / 10000`,
plus whatever the reference price is wrong by on the low side. The rest of the daily cap ends up as allowlisted
stock tokens or vault units in the owner's wallet, bought at a time the owner did not choose.

*Also:* the mandate does not check that an allowlisted basket was created by `BasketFactory`. It approves that
address for `maxUsdgIn` and calls `mint` on it. An owner should allowlist only addresses the factory lists.

*Tests:* A1 to A5 in `docs/invariants.md`, the mandate invariant suite, and on the fork
`test_mandateBlocksEveryOutOfBoundsTrade`. A leg that splits its output inside the slippage allowance is not
covered by a test.

### T12. Donations

Tokens or USDG sent to a vault only add to what its holders redeem pro rata. They cannot be minted against
(`test_mint_cannotMintAgainstSlack`) and do not move a unit price, because a unit is defined in shares and
there is no share-price math for a first depositor to attack. USDG sent to the router or the mandate contract is
not swept to the next caller (`test_refunds_doNotSweepStrayBalances`, `test_settle_doesNotSweepStrayBalance`).

### T13. Registry list growth and gas

`heldShares` and the pro-rata computation loop over every registered representation of every constituent. With
seven constituents and one representation each that is seven balance reads. Gas grows linearly with the number
of representations, and representations cannot be removed, so the admin should not add them without limit (see
also T4). No loop is bounded by user input.

### T14. USDG and Paxos

Paxos can pause USDG and freeze an address, and the token is upgradeable by its admin. While USDG is paused
nothing that moves USDG works: buys, sells, mints and USDG redemptions revert. In-kind redemption still works
when the vault holds no USDG, and otherwise through `redeemInKindSkipping` with USDG in the skip list. A freeze
on the router, a vault or the mandate contract has the same effect for that contract. The monitor reports a
USDG pause as critical.

USDG is taken at one dollar (D1). Chainlink publishes a USDG / USD feed and Parallax does not read it. The
assumption matters in one place on chain, the mandate floor: if USDG trades below a dollar, fair agent buys
return fewer shares than the floor expects and revert once the gap passes `maxSlippageBps`; if it trades above,
the floor is looser by the premium. Off chain it affects the premium and cost figures the resolver shows.
Nothing else depends on it: `minShares` is the caller's own bound in shares, and vault units are defined in
shares with no NAV on chain.

### T15. The resolver, the MCP server and the web app

The contracts do not trust any of them. They enforce what a transaction says, and the transaction's legs and
bounds are written off chain.

- **A wrong quote** (stale pool state, a bug, a moved price) produces either a transaction the contracts reject
  or one that executes inside the `minShares`, `maxUsdgIn` or `minUsdgOut` it carries. The resolver simulates
  first and withholds a transaction that fails.
- **A hostile resolver** is a different case. It chooses `minShares` and the leg calldata, and the web app
  sends the `to` and `data` it returns as they are. A user who signs without checking the target and the bounds
  is trusting the resolver. Run your own, or check what the wallet shows.
- **Through a mandate** the exposure is smaller. `execute_with_mandate` always sends to the `AgentMandate`
  address from the deployment file and builds the call itself, so a hostile resolver can at worst cause a trade
  the mandate allows, floor included (T11).
- **The agent key** is read from `AGENT_PRIVATE_KEY`. The MCP server's HTTP transport (`--http`) has no
  authentication and listens on every interface, so anyone who can reach the port can call the write tool. Use
  stdio, or keep the port private. The damage is bounded by the mandates that name the key.
- **The receipts index and the quote store** are conveniences. The chain's `RouteReceipt` events are the
  record; the public RPC keeps about ten minutes of state and caps `eth_getLogs`, so an index built from it can
  lag or miss history.
- **Mock networks.** `/health` `label.mocked` and the MCP tool `get_network` say what is mocked. A result there
  says nothing about a real market.

### T16. Eligibility

Robinhood Stock Tokens may not be offered or sold to U.S. persons and are restricted in other jurisdictions.
The web app asks each visitor to confirm, once, that they are not a U.S. person and not in a restricted
jurisdiction, and keeps the answer in the browser. It does not geolocate or verify anyone. The MCP server states
the restriction in `get_network` and in its instructions. The contracts do not check eligibility and cannot: the
tokens have no allowlist on transfers, and a contract cannot know who is calling it. Compliance with the
issuer's terms is the user's responsibility, and the issuer's own blocklist is the only on-chain enforcement.

## Known limits

- **Not audited.** No independent audit has been done. Comments tagged `audit F-1` to `F-6` in the contracts
  mark fixes from a review pass during development; that is not an audit.
- **What testing there is.** 139 Foundry tests (unit, fuzz, handler-based invariants, a harness smoke test), an
  opt-in fork test against chain 4663, and a Medusa / Echidna harness whose property list is
  `contracts/PROPERTIES.md`. A Medusa campaign on the ported code (6-decimal USDG) ran on 2 October 2026:
  367,275 calls in two and a half minutes, 93 properties passed, 0 failed. That is a short run, not a long
  campaign. No static-analysis run on the ported contracts is recorded.
- **Supply caps.** `StockRegistry.setSupplyCap` bounds what an unaudited vault can hold (D8). The deploy script
  applies a cap only when `SUPPLY_CAP_UNITS` is set, and its default is no cap. Set it for any deployment that
  holds real funds.
- **One admin key.** Everything in T4 applies until a multisig and timelock replace it.
- **One issuer, one venue.** Every stock token has the same issuer, with the powers in T6. Every leg goes
  through Uniswap v3; deeper liquidity on other venues is not reachable (D6).
- **No depeg check, no sequencer uptime check, no second price source** (T3, T14).
- **Weekends and holidays.** The mandate floor uses the last Chainlink print for up to 5 days (D5). The
  resolver's market schedule is computed and does not know holidays.
- **Splits.** `sharesPerUnit` is not rescaled after a corporate action (T6).
- **Vault calls depend on every registered representation answering `balanceOf`** (T4, T6).
- **The testnet deployment is mocks.** Robinhood Chain Testnet has no Uniswap and no Chainlink feeds, and five
  of the seven stocks do not exist there. The testnet deployment uses `MockStockToken`, `MockUSDG` and
  `MockSwapTarget`, priced once from mainnet Chainlink answers (D7). It shows that the contracts work, not that a
  real market would fill an order. The real tokens, feeds and pools are exercised by the fork test.
- **Deployment status** is in the table at the end of `docs/decisions.md`.
