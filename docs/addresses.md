# Addresses: source and on-chain check

Every chain id, RPC, token, feed, router and stablecoin address Parallax uses on Robinhood Chain, with the
official page it was taken from and the read that confirmed it on chain. Nothing here was taken from memory, a
ticker or a blog post. Checks were run on 2 October 2026 with `cast` 1.6.0 against the public endpoints; mainnet
reads at about block 77,930,000.

To redo the checks for the stock tokens, feeds and USDG in one step:

```
pnpm --filter @parallax-hood/scripts gen-universe
```

It refetches both source lists, re-reads every contract and stops on any mismatch. Its output is
`contracts/script/config/robinhood.json`, which the deploy scripts, the resolver and the fork test all read, so
there is one copy of each address in the repository's runtime path.

Abbreviations: `M` = `https://rpc.mainnet.chain.robinhood.com`, `T` = `https://rpc.testnet.chain.robinhood.com`.

## 1. Networks

Source for all rows: https://docs.robinhood.com/chain/connecting and
https://docs.robinhood.com/chain/add-network-to-wallet.

| | Mainnet | Testnet |
|---|---|---|
| Name | Robinhood Chain | Robinhood Chain Testnet |
| Chain id | 4663 | 46630 |
| Check | `cast chain-id --rpc-url M` → `4663` | `cast chain-id --rpc-url T` → `46630` |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | https://robinhoodchain.blockscout.com | https://explorer.testnet.chain.robinhood.com |
| Gas token | ETH, 18 decimals | test ETH, 18 decimals |
| Parent chain | Ethereum (1) | Sepolia (11155111) |
| Multicall3 `0xcA11bde05977b3631167028862bE2a173976CA11` | code present (3,808 bytes) | code present (3,808 bytes) |

Faucets: test ETH and test stock tokens from `faucet.testnet.chain.robinhood.com` (named in
https://robinhood.com/us/en/support/articles/robinhood-chain-mainnet/, not in the chain docs); test USDG from
https://faucet.paxos.com.

Limits of the public endpoints, measured: they keep state for roughly the last 6,000 blocks (about ten minutes
on mainnet), so a fork of the public mainnet RPC stops answering uncached reads after that; `eth_getLogs` returns
at most 10,000 logs per call; about 40 concurrent requests trigger HTTP 429 on mainnet. The docs recommend a keyed
provider (Alchemy) for archive reads.

What differs from Ethereum and matters here (https://docs.robinhood.com/chain/differences-from-ethereum):
`block.number` is an estimate of the L1 block number, so nothing in the contracts uses it for timing; the maximum
contract size is 96 KB; the sequencer excludes transactions tied to sanctioned addresses.

## 2. USDG and WETH

| Token | Address | Source | Check on chain 4663 |
|---|---|---|---|
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | https://docs.paxos.com/guides/stablecoin/usdg/mainnet ("Robinhood Mainnet"), and the "Token Smart Contracts" table at https://docs.robinhood.com/chain/contracts | code 170 bytes (ERC-1967 proxy); `symbol()` → `"USDG"`; `name()` → `"Global Dollar"`; `decimals()` → `6`; `totalSupply()` → `691187390165812` |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | https://docs.robinhood.com/chain/contracts | `symbol()` → `"WETH"`; `decimals()` → `18`; it is what `QuoterV2.WETH9()` and `SwapRouter02.WETH9()` return |

**USDG has 6 decimals.** Every share, ratio and USD price in Parallax is 1e18-scaled, so USDG amounts are
converted explicitly where the two meet: `AgentMandate.quoteScale` on chain, `usdgToWad` / `wadToUsdg` in the SDK.

What USDG is, from its verified source and simulated calls: `transfer`, `transferFrom` and `approve` return
`bool`; no fee on transfer; not rebasing; no approve-to-zero requirement. Paxos can pause it and can freeze an
address. It is upgradeable by its admin `0xcFA0388f5ddf905FdC08c45c716C15Dc10A14C6F`.

Testnet USDG is `0x7E955252E15c84f5768B83c41a71F9eba181802F`
(https://docs.paxos.com/guides/stablecoin/usdg/testnet; on chain 46630: 6 decimals, same proxy layout). The
testnet deployment of Parallax does not use it: see section 7.

## 3. Stock tokens

Source: `GET https://api.robinhood.com/rhj/assets`, the list the "Stock Tokens & Tokenized ETFs" table at
https://docs.robinhood.com/chain/contracts is rendered from. That page says: "a token with a matching name/ticker
but a different contract address is not a Robinhood Stock Token."

Check per token on chain 4663: code present, `decimals()` → `18`, `symbol()` equals the ticker, and
`uiMultiplier()` equals the API's `currentMultiplier`.

| Ticker | Token | `uiMultiplier()` at block 77,930,881 |
|---|---|---|
| NVDA | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | 1000775159164630595 |
| AAPL | `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9` | 1000566080061092436 |
| MSFT | `0xe93237C50D904957Cf27E7B1133b510C669c2e74` | 1000412952576205964 |
| AMZN | `0x12f190a9F9d7D37a250758b26824B97CE941bF54` | 1000000000000000000 |
| GOOGL | `0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3` | 1000193924414112587 |
| META | `0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35` | 1000541459879451635 |
| TSLA | `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` | 1000000000000000000 |

The ERC-8056 surface the tokens answer (https://docs.robinhood.com/chain/building-with-stock-tokens, confirmed by
calls): `uiMultiplier()`, `newUIMultiplier()`, `effectiveAt()`, `balanceOfUI(address)`, `totalSupplyUI()`.
`balanceOf` and `totalSupply` are raw and never rebase: shares = raw amount × `uiMultiplier()` ÷ 1e18. That is
`RatioSource.ERC8056` in `StockRegistry`, and `IERC8056.sol` and the mock token expose the same five views.

What the issuer can do, from the tokens' verified source (Sourcify, `src/Stock.sol:Stock`) and live calls:

- Transfers revert only when the token is paused or when the sender, the recipient or the caller is on the
  blocklist. There is no allowlist and no KYC gate on transfers: a contract can hold, approve and send them.
  Uniswap pools and other contracts already hold most of the float.
- The issuer can pause a token or all of them, block an address, and burn from any address.
- All tokens are beacon proxies behind one registry, `0xe10b6f6B275de231345c20D14Ab812db62151b00`, whose
  implementation can be replaced by a single key with no timelock.

So "redeem in kind always works" holds against everything Parallax controls and does not hold against the
issuer: a paused or blocked token cannot leave the vault until the issuer lifts it. The README and
`docs/threat-model.md` say so.

## 4. Chainlink feeds

Source: `https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json`, the directory behind
https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood. Check per feed on chain 4663: code present,
`decimals()` → `8`, `latestRoundData()` returns a positive answer, and `description()` names the ticker.

| Ticker | Feed proxy | `description()` | Answer when checked (8 decimals) |
|---|---|---|---|
| NVDA | `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15` | `RHNVDA / USD` | 23139663028 |
| AAPL | `0x6B22A786bAa607d76728168703a39Ea9C99f2cD0` | `Robinhood AAPL / USD` | 33047101721 |
| MSFT | `0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E` | `RHMSFT / USD` | 51478549424 |
| AMZN | `0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C` | `Robinhood AMZN / USD` | 24887000000 |
| GOOGL | `0xF6f373a037c30F0e5010d854385cA89185AE638b` | `Robinhood GOOGL / USD` | 33845562208 |
| META | `0x7C38C00C30BEe9378381E7B6135d7283356D71b1` | `Robinhood META / USD` | 72875437771 |
| TSLA | `0x4A1166a659A55625345e9515b32adECea5547C38` | `RHTSLA / USD` | 35668000000 |

All seven: 8 decimals, 86,400 s heartbeat, 0.5 % deviation, schedule `us_equities_24/5` (the directory's
`heartbeat`, `threshold` and `docs.marketHours` fields; heartbeat and deviation are documented values, not
readable on chain).

Two properties of these feeds shape the contracts:

1. **The answer is the price of the token, not of a share.** Robinhood's docs: "The Chainlink price already
   includes the corporate-action multiplier (dividends, splits), so the value you read is the token's full price."
   `StockRegistry.setTokenPriceFeed` records which token a feed prices and `referencePrice` divides the answer by
   that token's `uiMultiplier()`, so the mandate's floor is computed in USD per share.
2. **They stop over the weekend and on market holidays.** Chainlink: "These feeds do not publish updates,
   including heartbeat updates, while markets are closed." Over every round since launch (21 June 2026) the week
   runs Sunday 20:00 to Friday 20:00 New York time, an ordinary weekend gap is 48 to 72 hours, and the longest
   gap on any stock feed was 95.98 hours across a holiday weekend. `ConfigureRegistry` therefore sets
   `maxPriceAge` to 5 days. A shorter window would switch agent buys off every weekend; a stale price blocks
   agent buys only, never an owner's own trade or an exit.

Not used but verified, for reference: ETH / USD `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9` and USDG / USD
`0x61B7e5650328764B076A108EFF5fa7282a1B9aD2` (both 8 decimals). Parallax takes USDG at $1, as it took USDT on BNB
Chain; the USDG feed read `100001038` when checked.

Not available: there is no sequencer uptime feed for Robinhood Chain in Chainlink's directory, and only 35 of
Robinhood's 194 stock tokens have a price feed (all seven here do). The first rounds of each stock feed, 21 to 23
June 2026, were published 1e10 too large; the resolver's history drops any answer above 1e15.

## 5. Uniswap v3

Source: Uniswap's "Robinhood Chain Deployments" page,
https://docs.uniswap.org/contracts/v3/reference/deployments/ (same addresses in `Uniswap/contracts`
`deployments/4663.md`).

| Contract | Address | Check on chain 4663 |
|---|---|---|
| UniswapV3Factory | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` | code 24,535 bytes; `feeAmountTickSpacing` is 1, 10, 60, 200 for fees 100, 500, 3000, 10000 and 0 for 2500 |
| QuoterV2 | `0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7` | code 8,273 bytes; `factory()` → the factory above; `WETH9()` → WETH |
| SwapRouter02 | `0xCaf681a66D020601342297493863E78C959E5cb2` | code 24,497 bytes; `factory()` → the factory above; `WETH9()` → WETH |

SwapRouter02 is the one address on the registry's swap-target allowlist. A leg approves it for exactly `maxIn`,
calls it, and the approval is reset to zero; the router contract and the vault judge the result by balance deltas
only.

Deepest USDG pool per stock (`factory.getPool`, then balances), read at block ~77,930,000:

| Stock | Fee | Pool | Holds |
|---|---|---|---|
| NVDA | 0.05 % | `0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3` | 3,751 NVDA + 2.71M USDG |
| AAPL | 0.05 % | `0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D` | 653 AAPL + 127k USDG |
| MSFT | 0.30 % | `0xeb60bCD1D920ad6E102690CCFC6fB488899E1510` | 300 MSFT + 472k USDG |
| AMZN | 0.30 % | `0x8AC92DA74AB5F3b1d024Dc1943Ad7e15Dc4179Ef` | 2,072 AMZN + 349k USDG |
| GOOGL | 0.05 % | `0x34D0dC122CF9A8Eb296fC5e0D3A233625D7d19b7` | 1,688 GOOGL + 366k USDG |
| META | 0.30 % | `0x107a7Cb40d8665360ba10E59471Af06150A50922` | 280 META + 146k USDG |
| TSLA | 0.30 % | `0xf4ACdAEEB7022862A763C9B1B885e11191c889E3` | 858 TSLA + 206k USDG |

WETH / USDG 0.01 % holds 3,685 WETH + 16.06M USDG, and NVDA, AAPL, META and TSLA also have WETH pools, so the
resolver quotes USDG → WETH → stock as well as the direct pool and takes whichever returns more shares. Pool
addresses are never hard-coded: the quoting client asks the factory.

A live quote, to show the scale is right: `QuoterV2.quoteExactInputSingle(USDG → NVDA, 100000000, fee 500)` →
`431066873140846993`, that is 0.431 NVDA for 100 USDG, or $231.98 a token against a Chainlink answer of $231.40.

## 6. Venues looked at and not routed

A leg needs a contract that can be approved and called with a recipient. These were checked and left out of v1:

| Venue | Why it is not a leg |
|---|---|
| Uniswap v4 (PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951`) | Deep (it holds about a third of the NVDA supply), but swaps go through the UniversalRouter and Permit2, which does not fit approve-then-call; Uniswap's own sources list three different UniversalRouter addresses for this chain. A v4 adapter is the obvious next venue. |
| KyberSwap (router `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5`) | A keyless API returns calldata a contract can send; built but not simulated end to end, so not allowlisted. |
| Rialto | Needs an approved API key for calldata. |
| LI.FI, 1inch, 0x | Router contracts exist; API-built calldata, keys needed for the last two, contract-as-taker untested. |
| Lighter | Order book through a sequencer API; only `deposit()` is on chain. |
| Arcus | Signed intents relayed off chain; no contract addresses published. |
| Pleiades | No documentation or address found. |

## 7. Testnet: what exists and what Parallax mocks

On chain 46630 there is real USDG (section 2), WETH `0x7943e237c7F95DA44E0301572D358911207852Fa` and five test
stock tokens from the Robinhood faucet (TSLA, AMZN, PLTR, NFLX, AMD), all with a multiplier of exactly 1.

There is no Uniswap v3 deployment (the mainnet factory, quoter and router addresses have no code there), no
Chainlink price feed of any kind, and no NVDA, AAPL, MSFT, GOOGL or META token.

So the testnet deployment mocks, and labels as mocked in every API response and on every screen:

| Mocked | With | Why |
|---|---|---|
| Stock tokens | `MockStockToken`, one per stock, carrying its mainnet token's multiplier | five of the seven do not exist on testnet, and the faucet's supply cannot seed a venue |
| USDG | `MockUSDG`, 6 decimals | the Paxos faucet gives about 100 USDG a day per wallet, not enough to fund a venue's sell side |
| Swap venue | `MockSwapTarget` | no Uniswap on testnet |
| Reference prices | posted once from the mainnet Chainlink answers at generation time | no feeds on testnet |

Deployed addresses are in `contracts/deployments/46630.json` and the README once the deployment is run.
