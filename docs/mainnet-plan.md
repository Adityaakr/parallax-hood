# Mainnet deploy plan (not executed)

Nothing in this file has been run against Robinhood Chain mainnet. It is the plan to be approved before anything
is. Every address below is from `docs/addresses.md`; the gas figures are from running the same scripts on a local
chain on 2 October 2026.

## What gets deployed

Four contracts by `DeployCore`, then two vaults through the factory by `CreateBasket`. All are immutable: no
proxy, no upgrade path.

| Contract | Constructor arguments |
|---|---|
| `StockRegistry` | `admin` = the deployer address, `usdg` = `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| `ShareRouter` | `registry` = the `StockRegistry` above |
| `BasketFactory` | `registry` = the `StockRegistry` above, `admin` = the deployer address |
| `AgentMandate` | `router` = the `ShareRouter` above, `registry` = the `StockRegistry` above, `usdg` = `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |
| `BasketVault` "Parallax Magnificent 7" (`pxMAG7`) | created by `BasketFactory.createBasket(name, symbol, constituents)`: seven constituents, `sharesPerUnit` from `contracts/script/config/robinhood.json`, `maxIssuerBps` 10000 |
| `BasketVault` "Parallax AI Compute" (`pxAI`) | same call: NVDA 40 %, MSFT, GOOGL and META 20 % each |

`pnpm universe` is run immediately before deploying, so the indices are sized to about 100 dollars a unit at
that day's Chainlink prices and every token and feed is re-checked on chain.

## Configuration transactions (`ConfigureRegistry`)

1. `grantRole(KEEPER_ROLE, deployer)` and `grantRole(GUARDIAN_ROLE, deployer)` (in `DeployCore`).
2. `setFee(50, deployer)`: 0.5 % of USDG notional, paid to the deployer. The contract caps the fee at 1 %.
3. `setUnderlying` for NVDA, AAPL, MSFT, AMZN, GOOGL, META, TSLA.
4. `setAllowedTarget(0xCaf681a66D020601342297493863E78C959E5cb2, true)`: Uniswap v3 SwapRouter02, the only
   swap target.
5. `setLimits(type(uint64).max, 12 hours, 500)`: attestation gate off (decision D4), ERC-8056 step bound 5 %.
6. `setPriceLimits(5 days, 2000)`: decision D5.
7. `addRepresentation(token, ticker, "robinhood", ERC8056, uiMultiplier())` for each of the seven tokens.
8. `setTokenPriceFeed(ticker, feed, token)` for each of the seven feeds.
9. `postMarketState(ticker, true)` for each (informational only).

Then, in `CreateBasket`, per vault: `createBasket(...)` and `setSupplyCap(vault, cap)`.

## Caps for the first version

| Limit | Value | Where |
|---|---|---|
| Vault supply | **1 unit per vault** (`SUPPLY_CAP_UNITS=1`), about 100 dollars each, 200 dollars across both | `StockRegistry.setSupplyCap`, checked in `BasketVault.mint` |
| Demo mandate | 10 USDG per transaction, 20 USDG per day, 7 days, NVDA and pxMAG7 only, 300 bps maximum slippage | `AgentMandate.createMandate`, set by the owner |
| Protocol fee | 0.5 %, hard cap 1 % | `StockRegistry` |

The supply cap bounds deposits into the vaults. It does not bound single-stock buys through `ShareRouter`, which
holds nothing between transactions: a buy is the user's own USDG going through Uniswap to the user's own wallet.
The cap can be raised or lifted later by the admin; lowering it never blocks a redemption.

## Gas

Measured on a local chain with the same scripts (execution gas; Arbitrum adds a small L1 data component):

| Step | Transactions | Gas |
|---|---|---|
| `DeployCore` | 7 | 10,559,863 |
| `ConfigureRegistry` | about 31 | about 4,000,000 |
| `CreateBasket` (two vaults, plus two `setSupplyCap`) | 4 | about 8,550,000 |
| Total | | about 23,100,000 |

At the gas price read from chain 4663 on 2 October 2026 (0.0349 gwei) that is about 0.0008 ETH, about 2.20 US
dollars at the Chainlink ETH / USD answer of 2,719. No transaction is larger than about 4.3 million gas, well
under the chain's 32 million per-transaction limit. Runtime sizes are under 22 KB each, under both Ethereum's 24 KB
and this chain's 96 KB.

Funding the deployer with **0.005 ETH** on Robinhood Chain leaves room for the two demo transactions and a retry.

## The two real transactions after deploying

1. **One USDG vault deposit.** The deployer wallet approves pxMAG7 and mints 0.2 units for about 20 USDG, then
   redeems 0.1 unit in kind to show the exit. Quote from the resolver (`CHAIN_ID=4663`), simulated before sending.
2. **One agent-mandate trade.** The deployer creates the demo mandate above for a separate agent key that holds
   only gas, and the agent buys 5 USDG of NVDA through the MCP server's `execute_with_mandate`. The shares land in
   the deployer's wallet. Then one deliberately out-of-bounds request (15 USDG, over the per-transaction cap) to
   record the refusal.

USDG needed in the deployer wallet: about 30. Transaction links will be recorded in the README.

## What is needed from you

- Approval of this plan, including the caps and the fee setting.
- A deployer key in `robinhood/.env` (`DEPLOYER_PRIVATE_KEY`) holding about 0.005 ETH and about 30 USDG on
  Robinhood Chain, and an agent key (`AGENT_PRIVATE_KEY`) holding about 0.0005 ETH.
- Confirmation that the deployer is not a U.S. person and may hold Robinhood Stock Tokens: the two transactions
  buy real ones.

## Commands (after approval)

```bash
cd robinhood
pnpm universe
cd contracts
export USDG_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 SUPPLY_CAP_UNITS=1 FEE_BPS=50
for S in DeployCore ConfigureRegistry CreateBasket; do
  forge script script/Deploy.s.sol:$S --rpc-url robinhood --chain-id 4663 --broadcast --slow
done
```

The result is written to `contracts/deployments/4663.json` and committed. Source verification on Blockscout:
`forge verify-contract <address> src/<Name>.sol:<Name> --chain-id 4663 --verifier blockscout --verifier-url
https://robinhoodchain.blockscout.com/api/` (that API answered scripted requests from the build machine with a
Cloudflare challenge on 2 October; Sourcify lists chain 4663 and is the fallback).

## After deploying

- `CHAIN_ID=4663 pnpm monitor`: feeds, multipliers, pool depth and vault backing in one read-only pass.
- If something looks wrong: the guardian can pause buys (`setBuysPaused(true)`), the admin can set a vault's cap
  to its current supply, and neither action blocks a sale or a redemption. There is no way to move user funds
  and no upgrade.

## What stays true on mainnet

Unaudited. A single admin key. Robinhood can pause, block, burn and upgrade the stock tokens; Paxos can pause
and freeze USDG. Not available to U.S. persons.
