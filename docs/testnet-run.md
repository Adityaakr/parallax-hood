# Testnet deployment and run

Robinhood Chain Testnet, chain id 46630. Deployed on 2 October 2026 at block 127,443,925 by
`scripts/testnet-up.sh` from `0x9EBD65F44d6b27ed73B8F8Ab68B24A99E22b8Bdb`, a throwaway key that holds test funds only. The record
is `contracts/deployments/46630.json`.

**Everything a trade touches here is a stand-in**: the stock tokens, USDG and the swap venue are mocks.
The testnet has no Uniswap deployment and no Chainlink feeds, and five of the seven stocks do not exist on it
(`docs/addresses.md`, section 7). Each mock stock token was deployed with the multiplier its mainnet token had
and priced at the Chainlink answer its mainnet token had, at block 77,991,064 of chain 4663. Since the same
day a mirror keeps those numbers on mainnet's live values (the pool price, the Chainlink reference and the
multiplier; docs/decisions.md, D14), so the second run below traded at the real market's prices. What this
deployment shows is that the contracts enforce what they say on the real chain's EVM. It shows nothing about
real liquidity: the test venue fills any size at one price. The fork test and the fork run in the README
cover liquidity.

## Addresses

| Contract | Address |
|---|---|
| StockRegistry | [`0x5e3c867eCfC69eC76B1943E61BeE0D4CaA7ba68d`](https://explorer.testnet.chain.robinhood.com/address/0x5e3c867eCfC69eC76B1943E61BeE0D4CaA7ba68d) |
| ShareRouter | [`0x9fE3E7Bff316E0F2e8e22d92f06A3D304A73b504`](https://explorer.testnet.chain.robinhood.com/address/0x9fE3E7Bff316E0F2e8e22d92f06A3D304A73b504) |
| BasketFactory | [`0x63bF03A022aEA882fccb3648ac593D80Eb0EF084`](https://explorer.testnet.chain.robinhood.com/address/0x63bF03A022aEA882fccb3648ac593D80Eb0EF084) |
| AgentMandate | [`0xa7dEe60CD687A6060e450cEb4f6aAed97134fef2`](https://explorer.testnet.chain.robinhood.com/address/0xa7dEe60CD687A6060e450cEb4f6aAed97134fef2) |
| BasketVault pxMAG7 | [`0x77d091F1cb36c316BA99F3b96100b059b5f019b1`](https://explorer.testnet.chain.robinhood.com/address/0x77d091F1cb36c316BA99F3b96100b059b5f019b1) |
| BasketVault pxAI | [`0x5bAC6815917f95f29eD4CAAAf034925DcC28D1Cb`](https://explorer.testnet.chain.robinhood.com/address/0x5bAC6815917f95f29eD4CAAAf034925DcC28D1Cb) |
| MockUSDG (mock, 6 decimals) | [`0xB8d8898ED260aD81296a3DDD9F35AD1F4d0A0947`](https://explorer.testnet.chain.robinhood.com/address/0xB8d8898ED260aD81296a3DDD9F35AD1F4d0A0947) |
| MockSwapTarget (mock venue) | [`0x490f35155a130992F667989818d10d39c31867BE`](https://explorer.testnet.chain.robinhood.com/address/0x490f35155a130992F667989818d10d39c31867BE) |
| MockStockToken AAPL (mock) | [`0x81a5dD0BD655601552a9d55CC01F1531a0952E11`](https://explorer.testnet.chain.robinhood.com/address/0x81a5dD0BD655601552a9d55CC01F1531a0952E11) |
| MockStockToken AMZN (mock) | [`0xA80be676B96CDb0Fd58A0c5E8aAc11222cd826ca`](https://explorer.testnet.chain.robinhood.com/address/0xA80be676B96CDb0Fd58A0c5E8aAc11222cd826ca) |
| MockStockToken GOOGL (mock) | [`0x05A1cAa787bF9A446FA2A1Ff2B66cE24bA743200`](https://explorer.testnet.chain.robinhood.com/address/0x05A1cAa787bF9A446FA2A1Ff2B66cE24bA743200) |
| MockStockToken META (mock) | [`0xfCE153028B68cdf09F78aEc722B13fA53659A5cA`](https://explorer.testnet.chain.robinhood.com/address/0xfCE153028B68cdf09F78aEc722B13fA53659A5cA) |
| MockStockToken MSFT (mock) | [`0x5D38b238F2945166ce4712B01285A8923aB4E0ea`](https://explorer.testnet.chain.robinhood.com/address/0x5D38b238F2945166ce4712B01285A8923aB4E0ea) |
| MockStockToken NVDA (mock) | [`0xcd31ACd0A084Dafaaf627dd3D20042caC9D2c1AE`](https://explorer.testnet.chain.robinhood.com/address/0xcd31ACd0A084Dafaaf627dd3D20042caC9D2c1AE) |
| MockStockToken TSLA (mock) | [`0x2BBdFbAAfF34D53868abA892bA0D0Ff088362bcf`](https://explorer.testnet.chain.robinhood.com/address/0x2BBdFbAAfF34D53868abA892bA0D0Ff088362bcf) |

All fifteen contracts have their source verified on the testnet explorer (`forge verify-contract --verifier
blockscout`); the two vaults, which the factory creates, were verified with constructor arguments read back
from the chain.

Read back from the chain after deploying: USDG decimals 6, `AgentMandate.quoteScale` 1e12, attestation gate
off (`maxAttestationAge` is the largest uint64), `maxPriceAge` 432,000 seconds (5 days), fee 50 bps paid to the
deployer, every stock buy-eligible, both vaults fully backed. Deploying cost 0.00034 test ETH.

## The flow, with real transactions

Run on Robinhood Chain Testnet (chain 46630) on 2026-10-02 05:53 UTC by `scripts/e2e/flow.mts`. Mocked on this network: stock tokens, USDG, swap venue, reference prices.

Owner `0x9EBD65F44d6b27ed73B8F8Ab68B24A99E22b8Bdb`, agent `0xeC3ff9438700683f277CE3F50848D377d8d54A53`, mandate 1.

| Who | Step | Result | Transaction |
|---|---|---|---|
| owner | buy 100 USDG of NVDA | 0.431726 NVDA for 100.5 USDG, fee included, via mock | [`0x5582b733…`](https://explorer.testnet.chain.robinhood.com/tx/0x5582b733ceec0265b009f9f937f8c5694e570153a8f2ddb3f467f5d4bb75a758) |
| owner | deposit into pxMAG7 on a 200 USDG budget | 1.9779 units for 198.6 USDG to the venue plus the 0.5 % fee, 7 stocks bought in one transaction | [`0x7bf9a0e5…`](https://explorer.testnet.chain.robinhood.com/tx/0x7bf9a0e5888fb81e599533365704bf200779a43fbe445c287a26ac922da1ab87) |
| owner | vault backing after the deposit | every constituent backed, tightest ratio 1.0031 | none sent |
| owner | redeem 0.5 units to USDG | 50.11 USDG from the venue: 49.85 to the holder and 0.25 as the fee | [`0x7f53a1a0…`](https://explorer.testnet.chain.robinhood.com/tx/0x7f53a1a0f9686eb222fbac2e08eac8136da150334618713e0c5ec03d4544f8d7) |
| owner | redeem 0.25 units in kind | 7 stock tokens returned to the wallet, no venue and no price feed involved | [`0x4454829a…`](https://explorer.testnet.chain.robinhood.com/tx/0x4454829ae80c18765463c2c37074424ce1dbe450c04559f4efacb5debf3d0f37) |
| owner | create a mandate for the agent | 100 USDG per trade, 150 per day, NVDA and pxMAG7 only, 300 bps floor, 7 days | [`0x511a65a8…`](https://explorer.testnet.chain.robinhood.com/tx/0x511a65a8b6742ae4b618e2df01c008eea2f98d92dfdeab30715cc822104ca942) |
| agent | get_network | Robinhood Chain Testnet (testnet); mocked: stock tokens, USDG, swap venue, reference prices | none sent |
| agent | buy 50 USDG of NVDA under the mandate | owner received 0.215863 NVDA; agent holds 0 NVDA and 0 USDG | [`0xb2575c3b…`](https://explorer.testnet.chain.robinhood.com/tx/0xb2575c3be78c126011570dd3217a4d8440b107db0f1279b642f64ad9a77c621b) |
| agent | mint 0.4 pxMAG7 under the mandate | owner received 0.4 units | [`0x207991d6…`](https://explorer.testnet.chain.robinhood.com/tx/0x207991d6f68574b78222d0490707ee158564e1e6b4f24a1670f062779969086b) |
| agent | ask for 120 USDG of NVDA | refused: 120 USDG exceeds per-tx cap 100; 120 USDG exceeds remaining daily cap 59.385 | none sent |
| agent | ask for 10 USDG of AAPL | refused: AAPL is not on this mandate's allowlist | none sent |
| agent | ask for 70 USDG of NVDA | refused: 70 USDG exceeds remaining daily cap 59.385 | none sent |
| agent | call AgentMandate directly for 101 USDG | contract reverts: PerTxCapExceeded(101000000, 100000000) | none sent |
| agent | call AgentMandate directly for AAPL | contract reverts: UnderlyingNotAllowed(0x4141504c00000000000000000000000000000000000000000000000000000000) | none sent |
| agent | send the 101 USDG call anyway | transaction reverted on chain, nothing moved | [`0x46bc7fbb…`](https://explorer.testnet.chain.robinhood.com/tx/0x46bc7fbbc288766c1921bd167d8c2f0ad1196ca166dbe85c6974e7117b03fc45) |
| owner | revoke the mandate | one transaction | [`0x3100d2f4…`](https://explorer.testnet.chain.robinhood.com/tx/0x3100d2f48d32c33307a0ff4d8e3e283dd519444efb5a4aeb288c45bb2dd36b67) |
| agent | ask for 5 USDG of NVDA after revocation | refused: mandate revoked; 5 USDG exceeds remaining daily cap 0 | none sent |

The owner is also the fee recipient on this deployment, so the 0.5 % protocol fee it pays comes back to the
same account.

The agent's three requests through the MCP server were refused before anything was signed. The two direct
calls show the contract refusing by itself, without the server in the way, and one of them was sent so the
revert is on the explorer.

To repeat it, with the keys in `.env` and a resolver running on chain 46630:

```
set -a; . ./.env; set +a
CHAIN_ID=46630 RESOLVER=http://127.0.0.1:4100 pnpm --filter @parallax-hood/scripts e2e:flow
```

## The same flow at mainnet's live prices

Run on 2 October 2026 at 16:05 UTC with the resolver started by `pnpm testnet:dev`. Before it, the mirror's first
pass sent 14 transactions (a venue price and a reference price for each of the seven stocks; the multipliers
already matched) and left every stock at 0 bps from mainnet, for 0.0000062 test ETH. A few minutes before the
run the reference for NVDA was mainnet's Chainlink answer, 234.89 USD per share, and Robinhood's own quote was
235.55 bid, 235.56 ask.

Owner `0x9EBD65F44d6b27ed73B8F8Ab68B24A99E22b8Bdb`, agent `0xeC3ff9438700683f277CE3F50848D377d8d54A53`, mandate 2.

| Who | Step | Result | Transaction |
|---|---|---|---|
| owner | buy 100 USDG of NVDA | 0.423438 NVDA for 100.5 USDG, fee included, via mock | [`0xa03b0aec…`](https://explorer.testnet.chain.robinhood.com/tx/0xa03b0aece35d77d7f974d0873fb944657e2f45b56b972f708393b2797c3a87bc) |
| owner | deposit 200 USDG into pxMAG7 | 1.9178 units for 194.95 USDG, 7 stocks bought in one transaction | [`0xd6e3cd69…`](https://explorer.testnet.chain.robinhood.com/tx/0xd6e3cd69c007fe9001bb33c48c9196a39e0407050d14dec8688de56bfa3eeaf1) |
| owner | vault backing after the deposit | every constituent backed, tightest ratio 1.0031 | none sent |
| owner | redeem 0.5 units to USDG | 50.72 USDG received, net of the fee | [`0xb4d35fb6…`](https://explorer.testnet.chain.robinhood.com/tx/0xb4d35fb6bf23d7fbe7844c84ef3547da01aeb72651fb977c9a57541031ca2318) |
| owner | redeem 0.25 units in kind | 7 stock tokens returned to the wallet, no venue and no price feed involved | [`0x8682349b…`](https://explorer.testnet.chain.robinhood.com/tx/0x8682349b4a4741f5c1b7790d7fe986d254e0671394b3145cf8049c5b8d9f5f76) |
| owner | create a mandate for the agent | 100 USDG per trade, 150 per day, NVDA and pxMAG7 only, 300 bps floor, 7 days | [`0x45cfad6f…`](https://explorer.testnet.chain.robinhood.com/tx/0x45cfad6f206d89a7132a533eb61d9119dbbbef74647bf59d4ed302efc8dad736) |
| agent | get_network | Robinhood Chain Testnet (testnet); mocked: stock tokens, USDG, swap venue | none sent |
| agent | buy 50 USDG of NVDA under the mandate | owner received 0.211719 NVDA; agent holds 0 NVDA and 0 USDG | [`0xb1e11c13…`](https://explorer.testnet.chain.robinhood.com/tx/0xb1e11c13bae84f1bfe31ccd063469debf78b359f58e01633a3f8d8df29b685c1) |
| agent | mint 0.4 pxMAG7 under the mandate | owner received 0.4 units | [`0x83a5df69…`](https://explorer.testnet.chain.robinhood.com/tx/0x83a5df69c86c299e8d47fe73027406477c5f6476473e2d5ea7c5fe3a31db9efc) |
| agent | ask for 120 USDG of NVDA | refused: 120 USDG exceeds per-tx cap 100; 120 USDG exceeds remaining daily cap 58.885161 | none sent |
| agent | ask for 10 USDG of AAPL | refused: AAPL is not on this mandate's allowlist | none sent |
| agent | ask for 70 USDG of NVDA | refused: 70 USDG exceeds remaining daily cap 58.885161 | none sent |
| agent | call AgentMandate directly for 101 USDG | contract reverts: PerTxCapExceeded(101000000, 100000000) | none sent |
| agent | call AgentMandate directly for AAPL | contract reverts: UnderlyingNotAllowed(0x4141504c00000000000000000000000000000000000000000000000000000000) | none sent |
| agent | send the 101 USDG call anyway | transaction reverted on chain, nothing moved | [`0xa9c9f878…`](https://explorer.testnet.chain.robinhood.com/tx/0xa9c9f878d6ca492a088d3fa539deb3174d35c6e553fdec097d4d64a92fe8582b) |
| owner | revoke the mandate | one transaction | [`0x549e2f3f…`](https://explorer.testnet.chain.robinhood.com/tx/0x549e2f3f86896a9b6a32c740bf97e5147901ba5b9865448f15a4edb7ea7df7b7) |
| agent | ask for 5 USDG of NVDA after revocation | refused: mandate revoked; 5 USDG exceeds remaining daily cap 0 | none sent |

`GET /mirror` on the resolver lists, per stock, mainnet's value, the testnet's value, the drift and the
transactions of the last pass.
