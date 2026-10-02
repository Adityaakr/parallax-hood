# Phase 0 — Recon

Recorded 2026-09-17 (US market open, ~15:30 UTC). All onchain reads against BSC mainnet (chain id 56) via `https://bsc-dataseed.binance.org` using `cast`. Verified sources pulled from Sourcify (`sourcify.dev/server/v2/contract/56/<addr>`). Raw evidence lives in `fixtures/recon/`.

**Decision: GO (custodial vaults, Plan A).** Both issuers' tokens use blocklist + sanctions checks only — no allowlist — so contracts can hold and transfer them. Details and the one important caveat (Ondo execution depth) below.

---

## 0. Summary of findings

| # | Assumption | Result | Evidence |
|---|-----------|--------|----------|
| 1 | API access | **Needs key** — every Binance Web3 endpoint is signed (`X-OC-APIKEY`, `X-OC-TIMESTAMP`, `X-OC-SIGN` = Base64(HMAC-SHA256(ts+method+`/build`+path+query+body))). Rate limits: 1,200/min per IP and per key, 5 RPS per endpoint, 429 with `Retry-After`. Hackathon page promises elevated limits. Data endpoints are not gated by tier, only by key. | llms-full.txt (Authentication), reference SDK `binance-web3-connector-python` |
| 2 | Ratio direction | **Confirmed = underlying shares per token** for bStocks onchain: `NVDAB.uiMultiplier() = 1.000778`, PancakeSwap price per raw token $219.49 ≈ 1.000778 × Chainlink $219.18 = $219.35 (+6 bps residual = pool spread). Ondo's `tokenToShareRatio` (e.g. `1.003701`) is API-only; same semantic (dividends reinvested → shares/token > 1). | `fixtures/recon/depth.psv`, `census.psv` |
| 3 | Onchain ratio source | **bStocks: yes** — ERC-8056 `uiMultiplier()` (1e18), plus `pendingMultiplier()`/`effectiveAt()` for scheduled changes. **Ondo: no** — `GMToken` is a plain ERC-20; ratio is offchain (keeper-posted). | `sources/bstock/ERC8056BaseUpgradeable.sol`, `sources/ondo/GMToken.sol` |
| 4 | Token behavior / contract custody | **Both allow contract holders.** Ondo `GMToken._beforeTokenTransfer` → `compliance.checkIsCompliant(from/to/operator)` → `OndoCompliance`: per-token `IBlocklist.isBlocked` + Chainalysis `ISanctionsList.isSanctioned`. bStock `SecuritiesToken._update` → `Compliance.checkIsCompliant(token,user)`: `blockedAddresses[token][user]` + sanctions epoch set. Simulated `transfer` from pools to a contract (PancakeV3Factory) and to a fresh EOA both return `true`. Both **pausable** via an external pause manager (currently unpaused), both **upgradeable** (BeaconProxy; beacon owner = issuer multisig/EOA), both **18 decimals**, no fee-on-transfer, no `permit`. bStock balances are **raw units** (`balanceOf`) with a multiplier — not a balance-rebasing token, so vault accounting is stable. | §2, §3 |
| 5 | Liquidity venues | **bStocks: deep PancakeSwap v3 USDT pools** (NVDAB $1.24M @0.25%, AAPLB $524k, MSFTB $158k, AMZNB $60k, GOOGLB, METAB, TSLAB). **Ondo: near-zero AMM liquidity on BSC** (NVDAon $8.7k @1%, GOOGLon $1.6k, others empty); Ondo trades via Binance RFQ (EIP-712 signed by an EOA) and via KYC-gated `GMTokenManager` primary issuance. | §4 |
| 6 | Aggregator calldata for a contract sender | **Not verifiable without key.** SDK shows `build_swap_transaction(user_wallet_address, quote_id, …)` with no separate recipient; `vendor` may be `Pancake` (returns PancakeSwap router calldata). RFQ mode requires an EOA signature → cannot execute from ShareRouter/vault. **Decision:** the onchain execution path is a direct **PancakeSwap v3 adapter** (SmartRouter `0x13f4EA83…` / QuoterV2 `0xB048Bbc1…`), allowlisted as leg targets. Binance API is used for RWA data, reference prices, attestation URLs, market status, aggregated quotes (EOA comparison), and simulation. Binance `vendor=Pancake` calldata can be accepted as a leg once verified with a key. | SDK `trading_api.py`, §5 |
| 7 | Price feeds | **Chainlink push feeds exist for all Mag 7 on BSC mainnet** (8 dec, 24h heartbeat, 0.5% deviation; META 0.3%). Live: NVDA/USD $219.185 updated 15:26 UTC. Used for display NAV and deviation checks; Binance `referencePrice` as second source. | `fixtures/recon/chainlink-bsc.json`, §6 |
| 8 | Coverage | **All 7 Mag 7 names exist on both `ondo` and `bstock` on BSC** (14 tokens). Only bStock representations have executable AMM depth today; Ondo AMM depth is sufficient only for tiny NVDA/GOOGL/TSLA clips. `pxMAG7` will include all 7 names; issuer caps apply only where two buy-eligible representations exist (currently effectively NVDA/GOOGL). | §1 |
| 9 | xStocks | Present on BSC (`NVDAx` `0xc845b289…`, verified ERC-1967 proxy) but **no PancakeSwap USDT/USDC pools** → out of scope, roadmap. | §7 |
| 10 | Hackathon rules | Found official page. BSC **mainnet only**, spot only, must integrate bStocks/Ondo/xStocks, public repo + ≤4 min demo + deployed link, **Developer Experience Report = 25 % of score and must be human-written**, no token launches. Details in `docs/submission.md`. | https://www.bnbchain.org/en/hackathons/tokenized-stocks |

---

## 1. Magnificent 7 representations on BSC

All 14 are 18-decimal BeaconProxy tokens. Ondo tokens share beacon `0xc046b05a…73315` → impl `0x578f397C…850fd` (`GMToken`, solc 0.8.16). bStocks share beacon `0x156d6dce…e93a3` → impl `0xCFEd6c46…64e46` (`SecuritiesToken`, ERC-8056, solc ^0.8.24).

| Underlying | Platform | Symbol | Address | Ratio source | Ratio (onchain) | Pausable | Upgradeable | Transfer rule | Best USDT pool (fee, USDT) |
|---|---|---|---|---|---|---|---|---|---|
| NVDA | ondo | NVDAon | `0xa9ee28c80f960b889dfbd1902055218cba016f75` | keeper (API) | — | yes (TokenPauseManager `0x633492…638F`) | Beacon | blocklist+sanctions | 1% · $8,721 |
| AAPL | ondo | AAPLon | `0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4` | keeper | — | yes | Beacon | blocklist+sanctions | 0.01% · $23 |
| MSFT | ondo | MSFTon | `0x6bfe75d1ad432050ea973c3a3dcd88f02e2444c3` | keeper | — | yes | Beacon | blocklist+sanctions | none |
| AMZN | ondo | AMZNon | `0x4553cfe1c09f37f38b12dc509f676964e392f8fc` | keeper | — | yes | Beacon | blocklist+sanctions | none |
| GOOGL | ondo | GOOGLon | `0x091fc7778e6932d4009b087b191d1ee3bac5729a` | keeper | — | yes | Beacon | blocklist+sanctions | 1% · $1,588 |
| META | ondo | METAon | `0xd7df5863a3e742f0c767768cdfcb63f09e0422f6` | keeper | — | yes | Beacon | blocklist+sanctions | none |
| TSLA | ondo | TSLAon | `0x2494b603319d4d9f9715c9f4496d9e0364b59d93` | keeper | — | yes | Beacon | blocklist+sanctions | 0.25% · $7 |
| NVDA | bstock | NVDAB | `0x02fca66c1d1afb4e2a7884261eb00f63598a7436` | onchain `uiMultiplier` | 1.000778 | yes (PauseManager `0x9fc74B…700a`) | Beacon | blocklist+sanctions | 0.25% · $1,238,705 |
| AAPL | bstock | AAPLB | `0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a` | onchain | 1.000604 | yes | Beacon | blocklist+sanctions | 0.25% · $524,486 |
| MSFT | bstock | MSFTB | `0x80106cb3ead06659a5ad19df39d9b4733863b9b0` | onchain | 1.001314 | yes | Beacon | blocklist+sanctions | 0.25% · $157,911 |
| AMZN | bstock | AMZNB | `0x1a4b499833a79a09ad7cf1d42d7dacf71e92eb00` | onchain | 1.000000 | yes | Beacon | blocklist+sanctions | 0.25% · $60,318 |
| GOOGL | bstock | GOOGLB | `0x3f53de71c126bdabae20f9cd64848d317f6c3238` | onchain | 1.000478 | yes | Beacon | blocklist+sanctions | see `census.psv` |
| META | bstock | METAB | `0x7425889fe94f9d693e8daefe88bcced6acfef4c0` | onchain | 1.000000 | yes | Beacon | blocklist+sanctions | see `census.psv` |
| TSLA | bstock | TSLAB | `0x5b1910eaad6450e50f816082aa078c41f10c292f` | onchain | 1.000000 | yes | Beacon | blocklist+sanctions | see `census.psv` |

Attestation URLs come from `rwa/underlying-profile.protections.{daily,monthly}AttestationReport.url` (needs API key; see §8). bStocks also publish a Proof of Collateral page (`binance.com/proof-of-collateral/bstocks`, JS-rendered/WAF-gated to curl).

Token addresses were enumerated from CoinGecko platform data (`fixtures/recon/coingecko/mag7-representations.json`) and then verified onchain (name/symbol/beacon/impl). They will be cross-checked against `rwa/tokens?binanceChainId=56` once a key is available.

## 2. Ondo `GMToken` (verified, Sourcify runtime match)

Source: `fixtures/recon/sources/ondo/GMToken.sol`.

- `ERC20BurnableUpgradeable + AccessControlEnumerable + OndoComplianceGMClient + TokenPauseManagerClient`, solc 0.8.16.
- `_beforeTokenTransfer`: `_checkTokenIsPaused()`; `_checkIsCompliant(msg.sender)` when operator ≠ from/to; `_checkIsCompliant(from)`; `_checkIsCompliant(to)`.
- Compliance view `0x76be569C…250D0` (unverified, selectors resolved: `checkIsCompliant(address)`, `compliance()`, `gmIdentifier()`, Ownable2Step) → inner `OndoCompliance` `0x62fbBe03…8E61` (verified): `rwaTokenToBlocklist[token].isBlocked(user)` and `rwaTokenToSanctionsList[token].isSanctioned(user)`. `gmIdentifier` address has **no code** (unused on BSC).
- Live checks: `checkIsCompliant(PancakeV3Router)` and `checkIsCompliant(random EOA)` both succeed → **no allowlist**.
- Roles: `MINTER_ROLE` (2 members; member 0 = `GMTokenManager` `0x91f8Aff3…B299`, verified), `BURNER_ROLE`, `CONFIGURER_ROLE` (can change compliance/pause manager/name/symbol), `DEFAULT_ADMIN_ROLE`.
- `GMTokenManager.mintWithAttestation/redeemWithAttestation` require `ondoIDRegistry.getRegisteredID(gmIdentifier, msg.sender)` (KYC'd ID), `issuanceHours.checkIsValidHours()`, an Ondo-signed quote and a sanity-check oracle → **primary issuance is not usable by our contracts**; secondary market only.
- No onchain ratio, no `permit`, no fee-on-transfer, no rebasing.
- Beacon owner: `0x8860bbfc…3b26` (Ondo). Upgrade risk documented in threat model.

## 3. bStock `SecuritiesToken` (verified, Sourcify exact match)

Source: `fixtures/recon/sources/bstock/`.

- `ERC8056BaseUpgradeable + AccessControlEnumerable + ComplianceClient + PauseManagerClient`. ERC-8056 = "Scaled UI Amount": ERC-20 `balanceOf/transfer/totalSupply` are **raw** units; `uiMultiplier()` (1e18 scale) gives the display/share multiplier; `balanceOfUI = raw × multiplier / 1e18`; `toUIAmount/fromUIAmount` conversions; multiplier changes can be **scheduled** (`pendingMultiplier()`, `effectiveAt()`, ≤ 365 days ahead, bounded 1e-9x…1e9x), set by admin or `ISSUER_ROLE`.
- `_update`: pause check + compliance on operator/from/to. `Compliance` `0x53dBa7Aa…14F4` (verified): per-token `blockedAddresses` + global sanctions epoch set. No allowlist.
- Admin `0x45e35Fe9…679d`, 3 issuers (issuer 0 is a contract `0x59486026…daD1`); `mint/burn` are issuer/admin-only, `mintEnabled/burnEnabled` flags.
- Identifier (ISIN-like): NVDAB `AE000A4AVAZ9` (ADGM/FSRA listing).
- Dividend handling: multiplier increases (e.g. NVDAB 1.000778, MSFTB 1.001314); raw balances never change → vault holdings stable, shares computed at read time.

## 4. Liquidity (PancakeSwap, onchain)

Factory v3 `0x0BFbCF9f…1865`, factory v2 `0xcA143Ce3…0c73`. Per-pool balances in `fixtures/recon/census.psv`; executable quotes from QuoterV2 in `fixtures/recon/depth.psv`.

Executable cost per **share** (USDT in → tokens × ratio) vs Chainlink reference, 2026-09-17 ~15:35 UTC:

| Underlying | Ref | Rep | $100 | $1,000 | $10,000 |
|---|---|---|---|---|---|
| NVDA | 219.18 | NVDAB (0.05 %/0.25 %) | 219.31 (+6 bps) | 219.64 (+21) | 219.91 (+33) |
| NVDA | 219.18 | NVDAon (1 %) | 222.18 (+137 bps)* | 223.72 (+207)* | 507 (blown out) |
| AAPL | 332.07 | AAPLB | 333.44 (+41) | 333.44 (+41) | 333.47 (+42) |
| AAPL | 332.07 | AAPLon | no depth | — | — |
| MSFT | 495.03 | MSFTB | 496.98 (+39) | 497.08 (+41) | 498.12 (+62) |
| AMZN | 252.17 | AMZNB | 252.77 (+24) | 252.95 (+31) | 254.73 (+101) |
| GOOGL | 346.26 | GOOGLB | 347.61 (+39) | 347.65 (+40) | 348.06 (+52) |
| GOOGL | 346.26 | GOOGLon (1 %) | 351.40 (+148)* | 361.16 (+430)* | blown out |
| META | 675.69 | METAB | 676.09 (+6) | 676.74 (+16) | 682.87 (+106) |
| TSLA | 365.62 | TSLAB | 367.47 (+50) | 367.50 (+51) | 367.95 (+64) |
| TSLA | 365.62 | TSLAon (0.25 %) | 418.85 (+1456)* | — | — |

\* Ondo AMM prices computed with ratio = 1.0 (true ratio ≈ 1.00x per API, so Ondo cost per share is a few bps lower than shown). This is precisely the cross-issuer spread Parallax exists to route around.

Router/quoter contracts verified to have code: SmartRouter `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` (WETH9 = WBNB), v3 SwapRouter `0x1b81D678ffb9C0263b24A97847620C99d213eB14`, QuoterV2 `0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997`, v2 Router `0x10ED43C718714eb63d5aA57B78B54704E256024E`. USDT `0x55d398326f99059fF775485246999027B3197955` has **18 decimals** on BSC.

## 5. Binance Web3 API (documented shapes, unverified live)

Base `https://web3.binance.com/build`. All RWA endpoints exist with the documented field names (confirmed from the official Python SDK models): `rwa/tokens` → `tokenToShareRatio`, `statusInfo{openState, marketStatus, reasonCode, nextOpenTime, nextCloseTime}`, `tokenPrice`, `referencePrice`, `volume24h`; `rwa/underlying-profile` → `protections{…}.url`, `companyInfo`; `rwa/price` → `tokenPriceUpdatedAt`; `rwa/search` → `assets[]{platformId, binanceChainId, tokenContractAddress, tokenSymbol, assetType}`.

Trading: `GET /api/v1/dex/aggregator/quote` (`vendor` ∈ `LiquidMesh|Pancake|Jupiter`, `executionMode` `SWAP|RFQ`, `quoteId` TTL 30 s, `approveTarget`, `router`), `GET /api/v1/dex/aggregator/swap` (`tx{from,to,data,value,gas,minReceiveAmount}` or `rfq{typedDataToSign}`), `POST /api/v1/dex/pre-transaction/simulate`, `gas-price`, `gas-limit`, `broadcast-transaction`. Docs state Ondo tokens are **always RFQ** and unavailable outside US market hours (error 40367); bStock may be SWAP or RFQ (40369 when closed).

Consequence: the Binance aggregator is the right tool for an **EOA** buying Ondo tokens, and for data. For contract-executed legs (ShareRouter, vault mint/migrate) we use PancakeSwap directly. The resolver reports both so the user sees when an RFQ-only path would have been cheaper.

## 6. Price feeds (Chainlink, BSC mainnet, verified live)

| Feed | Proxy | Dec | Heartbeat | Deviation |
|---|---|---|---|---|
| NVDA/USD | `0xea5c2Cbb5cD57daC24E26180b19a929F3E9699B8` | 8 | 24h | 0.5 % |
| AAPL/USD | `0xb7Ed5bE7977d61E83534230f3256C021e0fae0B6` | 8 | 24h | 0.5 % |
| MSFT/USD | `0x5D209cE1fBABeAA8E6f9De4514A74FFB4b34560F` | 8 | 24h | 0.5 % |
| AMZN/USD | `0x51d08ca89d3e8c12535BA8AEd33cDf2557ab5b2a` | 8 | 24h | 0.5 % |
| GOOGL/USD | `0xeDA73F8acb669274B15A977Cb0cdA57a84F18c2a` | 8 | 24h | 0.5 % |
| META/USD | `0xfc76E9445952A3C31369dFd26edfdfb9713DF5Bb` | 8 | 24h | 0.3 % |
| TSLA/USD | `0xEEA2ae9c074E87596A85ABE698B2Afebc9B57893` | 8 | 24h | 0.5 % |

Live `latestRoundData` NVDA = 21918500000 (updated 1789654016), AAPL = 33207500000. Feeds are push-model (not Data Streams), so they may lag intraday; they are display/deviation inputs only and never gate mint/redeem (share-denominated units need no oracle).

## 7. xStocks

`NVDAx` `0xc845b2894dbddd03858fd2d643b4ef725fe0849d` (Backed; same address on Ethereum/Arbitrum/Mantle/Ink/X Layer), 18 dec, verified ERC-1967 proxy. No PancakeSwap v2/v3 pools against USDT or USDC on BSC. Out of scope for MVP; the registry is platform-agnostic so adding `xstock` later is configuration plus a ratio adapter.

## 8. Blocked items and what unblocks them

| Item | Blocker | Fallback in place |
|---|---|---|
| Live `rwa/*` fixtures, attestation URLs, Ondo ratios, market status | `BINANCE_WEB3_API_KEY/SECRET` not present on this machine | `binance-client` ships with a `fixtures` mode; recon fixtures are labeled; keeper posts from API when key arrives |
| Build-swap-with-contract-sender test | same | PancakeSwap direct adapter is the execution path regardless |
| Mainnet deploy + real txs | `DEPLOYER_PRIVATE_KEY` + BNB/USDT funding | Full fork suite (`anvil --fork-url`) exercises real tokens and pools |

## 9. Go / Plan B

**GO.** Contracts can custody both issuers' tokens. Vault accounting is stable (bStock raw balances + multiplier; Ondo plain ERC-20 + keeper ratio). Deep, contract-callable liquidity exists for every Mag 7 name via bStocks; Ondo representations are registered, scored and shown, and become routable the moment their AMM depth (or an EIP-1271-compatible RFQ settlement) allows. Risks carried into the threat model: issuer pause managers, beacon upgrades, blocklists applied to vault/router addresses, scheduled multiplier changes.
