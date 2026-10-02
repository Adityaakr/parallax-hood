# Two-minute demo

Record against the testnet deployment (or `pnpm mocks:up` locally). Keep the network chip and the "mocked here"
banner in frame whenever the app is on screen: the stock tokens, USDG and the venue on the testnet are mocks, and
the video should not suggest otherwise. The one part shown against the real market is the terminal quote in
step 2, which is chain 4663 and says so.

Before recording: resolver running, wallet connected and funded with test USDG, MCP server running with an agent
key, a mandate not yet created, one terminal ready with the two commands below.

| Time | On screen | Say |
|---|---|---|
| 0:00 | `/stocks`, NVDA row: ratio 1.000775 | "A Robinhood stock token is not a share. Each token carries an on-chain multiplier that grows with every reinvested dividend and jumps on a split. Hold one NVDA token today and you own 1.000775 shares. So Parallax counts shares." |
| 0:15 | `/buy/NVDA`, type 500 | "Five hundred USDG of Nvidia. The quote is in shares, the price is dollars per share against Chainlink, and the minimum the contract will accept is in shares too." |
| 0:28 | Terminal: `curl … /resolve` on `CHAIN_ID=4663` | "Same request against the real chain, read only. It reads Uniswap's pools directly and here it routes through WETH, because for this size two hops return more shares than the direct pool." |
| 0:42 | Back in the app: approve, buy, the receipt in `/receipts` | "One transaction. The receipt on chain carries the hash of the scoring record, so anyone can see why this route was taken." |
| 0:55 | `/baskets/pxMAG7`: constituents and shares per unit | "An index here is not a weight that drifts. One unit of pxMAG7 is a fixed number of shares of seven stocks, and the vault has to hold at least that for every unit outstanding, after every call, or the call reverts." |
| 1:08 | Invest 100 USDG, mint; the backing column reads at least 1.00 | "Deposit USDG, the vault buys all seven in the same transaction. Backing is one or above on every line." |
| 1:20 | Redeem tab: "in kind" | "And you can always leave with the stocks themselves. In-kind redemption needs no venue, no price feed and nothing Parallax can pause." |
| 1:30 | `/mandates`: create one: 100 per trade, 150 a day, NVDA and pxMAG7, seven days | "Now an agent. The owner signs a mandate: a hundred USDG per trade, a hundred and fifty a day, Nvidia and this vault only, for a week." |
| 1:42 | Claude with the Parallax MCP server: "Buy 50 USDG of NVDA under mandate 1" → `execute_with_mandate` result | "The agent buys through the mandate contract. The shares land in the owner's wallet. The agent holds nothing." |
| 1:52 | Same chat: "Buy 120 USDG of NVDA" and "Buy 10 USDG of AAPL" → both refused | "Over the cap: refused. A stock that is not on the list: refused. Those limits are in the contract, not in the prompt." |
| 1:58 | `/mandates`: revoke; the network chip in frame | "Revoking is one transaction. Parallax on Robinhood Chain: shares, not tokens." |

The two terminal commands:

```bash
# step 2: a real quote from chain 4663, no key and nothing deployed
curl -s -X POST localhost:4163/resolve -H 'content-type: application/json' \
  -d '{"ticker":"NVDA","usdAmount":"500"}' | jq '{status, referencePrice, chosen: .chosen.why}'

# before recording: the read-only health check of the live feeds, multipliers and pools
pnpm monitor
```

Things not to say: that it is live on mainnet (it is not until the mainnet plan is approved and run), that it is
audited (it is not), or any volume or user figure (there are none).
