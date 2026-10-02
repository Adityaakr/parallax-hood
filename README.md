# Parallax on Robinhood Chain

> One stock. Many tokens. One true position, in shares.

Parallax buys Robinhood stock tokens through Uniswap measured in **underlying shares**, packages them into
**USDG-settled index vaults** whose unit is a fixed number of shares, and lets a wallet owner hand an AI agent an
**on-chain mandate** it cannot break. Built for the Arbitrum Open House Singapore buildathon.

**Not available to U.S. persons.** Robinhood Stock Tokens "are not registered under U.S. securities laws and may
not be offered, sold, or delivered, directly or indirectly, in the United States or to, or for the account or
benefit of, U.S. persons", and are restricted in other jurisdictions including Canada, the United Kingdom and
Switzerland ([source](https://docs.robinhood.com/chain/stock-tokens)). The app asks every visitor to confirm
eligibility before it can be used. Parallax is an independent project, not affiliated with or endorsed by
Robinhood, Paxos, Chainlink or Uniswap. Unaudited software. Not investment advice.

## The problem

A stock token is not a share. Every Robinhood stock token carries an on-chain multiplier (ERC-8056
`uiMultiplier()`): dividends are reinvested into it and a split changes it, so the number of tokens you hold is
not the number of shares you own. NVDA's multiplier is already 1.000775. After a two-for-one split it will be
about 2. Anything that counts tokens, quotes a price per token or sets a slippage limit in tokens is measuring
the wrong thing, and the Chainlink feeds for these tokens price the token, multiplier included, so even "the
price" needs converting before it means a share.

Three things follow from that, and Parallax does each one on chain:

1. **An index should hold shares, not dollar weights.** A pxMAG7 unit is a fixed number of shares of each of
   seven stocks. The vault must hold at least `units × sharesPerUnit` of every constituent after every call or
   the call reverts. You deposit USDG, the vault buys each stock through Uniswap v3 in the same transaction, and
   you can leave in USDG or in kind, taking the stock tokens themselves.
2. **An agent should be able to trade without being able to take.** `AgentMandate` gives an agent a
   per-transaction cap and a daily cap in USDG, an expiry, an allowlist of stocks and vaults, and a floor against
   the Chainlink price. Whatever it buys goes to the owner. Revoking is one transaction.
3. **Best execution should be per share.** Quotes come straight from the chain (Uniswap v3 factory and
   QuoterV2), across fee tiers and through WETH where that returns more, and are ranked in dollars per
   underlying share. The slippage limit the contract enforces is `minShares`, in shares.

## What is real and what is mocked

| | Robinhood Chain mainnet (4663) | Robinhood Chain Testnet (46630) | Local |
|---|---|---|---|
| Stock tokens | real, verified ([addresses](docs/addresses.md)) | **mock** (`MockStockToken`) | fork: real, mocks chain: mock |
| USDG | real, 6 decimals | **mock** (`MockUSDG`, 6 decimals) | fork: real, mocks chain: mock |
| Swap venue | Uniswap v3 SwapRouter02 | **mock** (`MockSwapTarget`) | fork: real pools, mocks chain: mock |
| Reference price | Chainlink feeds | **snapshot** of the mainnet feeds, posted once | fork: real feeds, mocks chain: snapshot |
| Parallax contracts | not deployed (needs approval) | see Deployments | deployed by `pnpm mocks:up` / `pnpm fork:up` |

The testnet has no Uniswap deployment and no Chainlink feeds, and five of the seven stocks do not exist there, so
the testnet deployment cannot use real ones ([details](docs/addresses.md#7-testnet-what-exists-and-what-parallax-mocks)).
The real tokens, feeds and pools are exercised by the fork test and by `pnpm fork:up`. The resolver's `/health`
returns a `label` naming the network and listing what is mocked; the MCP server's `get_network` returns the same;
the app shows it on every screen.

Mainnet quotes work today without any deployment: run the resolver with `CHAIN_ID=4663` and it quotes the real
pools against the real feeds, and returns no transaction.

## Deployments

| Network | Status |
|---|---|
| Robinhood Chain mainnet (4663) | Not deployed. Deployment waits for explicit approval of the plan in [docs/mainnet-plan.md](docs/mainnet-plan.md). |
| Robinhood Chain Testnet (46630) | Not deployed yet: `pnpm testnet:up` needs a key funded with test ETH. Addresses will be recorded in `contracts/deployments/46630.json` and listed here. |

## Run it locally (under ten minutes)

Needs Node 22, pnpm 11 and [Foundry](https://getfoundry.sh).

```bash
pnpm install
pnpm --filter @parallax-hood/sdk build && pnpm --filter @parallax-hood/uniswap-client build && pnpm --filter @parallax-hood/resolver build

pnpm mocks:up                                              # anvil :8648 (chain 1337): mocks, contracts, pxMAG7 and pxAI
CHAIN_ID=1337 pnpm --filter @parallax-hood/resolver dev    # resolver on :4100
NEXT_PUBLIC_RESOLVER_URL=http://127.0.0.1:4100 NEXT_PUBLIC_DEFAULT_CHAIN=1337 pnpm --filter @parallax-hood/web dev   # app on :3200
```

Open http://127.0.0.1:3200/stocks, connect a wallet on the local chain and use "Get test USDG".

Against the real market, quote-only (no key, nothing deployed):

```bash
CHAIN_ID=4663 pnpm --filter @parallax-hood/resolver dev
curl -s -X POST localhost:4100/resolve -H 'content-type: application/json' -d '{"ticker":"NVDA","usdAmount":"1000"}'
```

Against a fork of mainnet, with the real tokens, feeds and pools and Parallax deployed on top:

```bash
ROBINHOOD_FORK_RPC_URL=<archive endpoint> pnpm fork:up     # anvil :8647 (chain 31337)
CHAIN_ID=31337 pnpm --filter @parallax-hood/resolver dev
```

The public RPC keeps about ten minutes of state, so a fork of it stops answering soon after it starts. Use an
archive endpoint for anything longer; Robinhood's docs recommend Alchemy.

The agent side:

```bash
pnpm --filter @parallax-hood/mcp build
CHAIN_ID=1337 RESOLVER_URL=http://127.0.0.1:4100 AGENT_PRIVATE_KEY=0x<agent key> node apps/mcp/dist/index.js --http   # :4110
```

See [apps/mcp/README.md](apps/mcp/README.md) for the tools and for wiring it into Claude.

Ports: resolver 4100, MCP 4110, monitor 4120, web 3200, fork anvil 8647, mocks anvil 8648.

## Tests

```bash
pnpm contracts:test          # 139 Foundry tests: unit, fuzz, handler-based invariants
pnpm contracts:fork-test     # the whole flow against real chain 4663 state (see below)
pnpm test                    # SDK, quoting client, resolver, monitor, MCP (the last two suites need `pnpm mocks:up`)
pnpm monitor                 # read-only health check of the live feeds, multipliers and pools
```

The fork test (`contracts/test/fork/RobinhoodChain.t.sol`) reads every address from the same generated config
the deploy scripts use, then against the real stock tokens, Chainlink feeds, USDG and Uniswap v3 pools it:
registers the seven stocks, routes a buy and sells it back, buys through WETH in two hops, creates the pxMAG7
vault, deposits USDG, redeems to USDG and redeems in kind, creates a mandate, has the agent buy and mint within
it, and checks the mandate rejects an over-cap trade, a stock off the allowlist, a swap that pays the agent, a
trade over the daily cap and anything after revocation. Nothing is sent to the chain: it all runs inside
forge's fork. Last run, 2 October 2026, pinned at block 77,977,963 on the public RPC:

```
[PASS] test_agentBuysWithinTheMandate_ownerReceives()
[PASS] test_agentMintsTheVaultWithinTheMandate()
[PASS] test_buySharesThroughUniswap_thenSell()
[PASS] test_buyThroughWeth_twoHops()
[PASS] test_mag7Vault_mintRedeemAndRedeemInKind()     USDG spent on two pxMAG7 units: 200.719499
[PASS] test_mandateBlocksEveryOutOfBoundsTrade()
[PASS] test_referencePriceIsPerShare()                NVDA 231.3966 per token, 231.2174 per share
[PASS] test_tokensFeedsAndUsdgMatchTheConfig()
8 tests passed, 0 failed (87 s)
```

The browser journey (`pnpm --filter @parallax-hood/scripts e2e:browser`, against `pnpm mocks:up`) drives the app
in Chromium with an injected test wallet: eligibility gate, network label, a 100 USDG purchase, a 50 USDG vault
deposit, an in-kind redemption, then the portfolio and activity pages, with balances checked on chain after
each step.

The full stack on a fork (`pnpm fork:up`, resolver on chain 31337, MCP server with an agent key), recorded
2 October 2026 at block 77,980,551, with the resolver building every leg and the contracts executing them
against the real pools:

```
resolve NVDA 200 USDG     uniswap-v3:100>3000 (USDG to WETH to NVDA), +32 bps vs Chainlink, simulation ok
index-mint pxMAG7         PASS, paid 100.84 USDG for 1 unit, backing 1.0001 on the tightest constituent
index-mint pxAI           PASS, paid 100.87 USDG for 1 unit
agent buy 50 USDG NVDA    success through AgentMandate: owner +0.215390 NVDA, agent holds 0 NVDA and 0 USDG
agent mint 0.5 pxMAG7     success, units delivered to the owner
agent buy 120 USDG        refused: exceeds per-tx cap 100
agent buy AAPL            refused: AAPL is not on this mandate's allowlist
agent buy 60 USDG         refused: exceeds remaining daily cap 49.32754
```

Fuzzing beyond Foundry: `contracts/medusa.json` and `contracts/echidna.yaml` drive the harness in
`contracts/test/fizz` (properties in [contracts/PROPERTIES.md](contracts/PROPERTIES.md)). `FOUNDRY_PROFILE=fuzz
medusa fuzz --timeout 150` on the ported contracts, 2 October 2026: 367,275 calls, 93 properties passed, 0
failed.

## Architecture

```
contracts/              Foundry. StockRegistry, ShareRouter, BasketVault, BasketFactory, AgentMandate, LegExecutor
packages/sdk            chains, addresses, ABIs, share math, USDG units, leg encoding, receipts
packages/uniswap-client Uniswap v3 quoting straight from the chain: pools from the factory, prices from QuoterV2
apps/resolver           Hono service: scoring per share, routing, vault quoting, simulation, quote records, receipts index
apps/mcp                MCP server (stdio and HTTP): read tools, and one write tool that acts only through AgentMandate
apps/monitor            read-only health check: feeds, multipliers, issuer pauses, pool depth, vault backing
apps/web                Next.js app: stocks, indices, portfolio, activity, agents
scripts/                gen-universe (builds the token and feed config from the official lists), bring-up scripts
docs/                   addresses, architecture, invariants, threat model, decisions, demo script
```

USDG has 6 decimals and everything else (shares, ratios, prices) is 1e18-scaled; the two meet in one place on
chain (`AgentMandate.quoteScale`) and through two helpers off chain. There is no keeper: the share ratio is each
token's own multiplier and the price is a Chainlink feed, so nothing has to be posted for the system to stay
live. More in [docs/architecture.md](docs/architecture.md) and [docs/decisions.md](docs/decisions.md).

## Security notes

- **Not audited.** What exists: 139 Foundry tests with fuzz and handler-based invariant suites (backing,
  redeem in kind, monotone migration, mandate caps), a Medusa/Echidna harness, and the fork test. Each invariant
  and the test that enforces it is in [docs/invariants.md](docs/invariants.md).
- **Caps.** A vault's supply can be capped by the admin (`setSupplyCap`); the cap stops new mints and never a
  redemption. Mandates carry per-transaction and daily caps. The protocol fee is 0.5 % of USDG notional and is
  hard-capped at 1 % in the contract; in-kind redemption carries none.
- **Legs trust balance deltas only.** A swap leg may call only an allowlisted target (SwapRouter02), is approved
  for exactly `maxIn`, and the approval is reset to zero afterwards.
- **Who is trusted.** The admin is a single deployer key for now (production: a multisig behind a timelock).
  Robinhood, as issuer, can pause a token, block an address, burn, and upgrade the token contracts. Paxos can
  pause USDG or freeze an address. So "redeem in kind always works" holds against everything Parallax controls
  and not against the issuers: a paused token stays in the vault until its issuer lifts the pause, while the
  other constituents can still be withdrawn.
- **Prices.** Chainlink's stock feeds stop from Friday 20:00 to Sunday 20:00 New York time. A stale price blocks
  agent buys only, never an owner's own trade or an exit. USDG is taken at one dollar.
- The full list is in [docs/threat-model.md](docs/threat-model.md).

## Where every address comes from

[docs/addresses.md](docs/addresses.md) lists each chain id, RPC, token, feed, router and stablecoin address with
the official page it was taken from and the on-chain read that confirmed it. `pnpm universe` regenerates the
token and feed config from Robinhood's asset list and Chainlink's feed directory and re-checks every entry on
chain.
