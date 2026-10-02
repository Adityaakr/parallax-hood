# Threat model

What can go wrong, who can cause it, what bounds the damage, and what we did about it. Trust assumptions are stated plainly; nothing here claims decentralization that was not built.

## Actors and trust

| Actor | Power | Trust level (hackathon) | Production recommendation |
|---|---|---|---|
| **ADMIN** (`DEFAULT_ADMIN_ROLE` on registry and factory) | register/deprecate representations, allowlist swap targets, set limits, confirm out-of-band ratios, create baskets | Deployer EOA. Fully trusted. | Multisig + 48h timelock; allowlist changes and `confirmRatio` behind the timelock. |
| **KEEPER** | post Ondo ratios (bounded), attestation timestamps, market state | Single hot key. Trusted but bounded. | Multiple keepers + median, or move ratio to a signed oracle feed. |
| **GUARDIAN** | pause buys | Same EOA as admin. | Separate key held by an on-call operator. |
| **Issuers** (Ondo, BTech/bStocks) | pause their token, blocklist addresses, upgrade the beacon, change multipliers, mint/burn | External. Cannot be mitigated onchain, only diversified. | Issuer caps across ≥ 2 issuers; in-kind exit. |
| **Users / agents** | call public functions with arbitrary legs | Untrusted. | — |
| **Swap targets** (PancakeSwap SmartRouter, v3 SwapRouter) | receive approvals for exactly one leg's `maxIn` | Allowlisted, audited third-party code. | Keep the allowlist minimal; add targets behind the timelock. |
| **Resolver / MCP server** | build legs, store scoring records, hold the agent key | Offchain, untrusted by contracts. Compromise can only produce transactions the contracts accept. | Run by the user; keys in env; simulation before send. |

## Threats

### T1 — Malicious calldata in a leg
*Attacker:* any caller (including a compromised resolver).
*Attack:* legs that call a router with calldata that pulls more than expected, pays a different recipient, swaps into the wrong token, or reenters.
*Bounds:* target must be allowlisted; approval is set to `maxIn` for `tokenIn` only and reset to zero; results are measured by balance deltas on the executing contract; `tokenOut` must be a buy-eligible representation of the requested underlying (router, mint) or of the migrated constituent (migrate); `minShares` / `minUsdtOut` / `minShareGain` bound the economic outcome; `ReentrancyGuard` on every entry point.
*Residual:* a leg can be economically bad within the caller's own slippage bound — that is the caller's choice, and for baskets the invariants prevent the vault from being harmed (surplus only).
*Tests:* L1–L4, `test_buyShares_adversarialVenues`, `test_agent_cannotRedirectRecipient`.

### T2 — Compromised keeper: ratio manipulation
*Attack:* post an inflated ratio for a keeper-sourced representation so the vault believes it holds more shares (enabling under-collateralized mints) or a deflated one to block mints.
*Bounds:* each post may move the ratio at most `maxRatioStepBps` (5 %) from the last value; a 5 % overstatement lets a minter under-pay by ≤ 5 % on that constituent's slice until ADMIN corrects; repeated steps require time (every post is an event; the keeper runs an alert on rejections). ERC-8056 tokens (all bStocks) do not depend on the keeper at all. Redeem in kind is unaffected (it distributes tokens, not shares).
*Mitigation roadmap:* median of N keepers; cap total drift per day; move Ondo ratio to a signed feed.
*Tests:* S1, `test_postRatio_rejectsLargeStep`.

### T3 — Compromised keeper: attestation / market state
*Attack:* post a fresh `attestedAt` for a platform whose attestations have actually stopped; or lie about market state.
*Bounds:* attestation only gates *buys*; the honest failure mode (stale) blocks buys, not exits. Market state is informational onchain and enforced by resolver policy; the resolver also reads `statusInfo` from the Binance API directly. Timestamps cannot be in the future or go backwards.
*Residual:* buys continue against a platform with stale attestations for up to `maxAttestationAge` after the lie. Accepted for MVP; documented in UI.

### T4 — Compromised ADMIN
*Attack:* allowlist a malicious swap target, register a fake representation, confirm a wrong ratio, deprecate everything.
*Bounds:* even a malicious admin cannot move funds directly: the vault only executes legs supplied by callers under invariants; a malicious *allowlisted target* plus a malicious *caller* could drain a caller's own leg inputs but not the vault's other holdings (approval is per-leg, per-token); a fake representation with a huge ratio could let the admin mint under-backed units — this is the real admin risk.
*Mitigation:* timelock + multisig in production; the UI shows every registry change event; deprecating a representation never blocks exits.

### T5 — Stale data
*Attack / accident:* keeper offline, API down, ratio or attestation ages out.
*Behavior:* buys into the stale representation stop (`isBuyEligible = false`); sells, redeems and in-kind redemption continue; the resolver excludes stale candidates with a visible reason; fixtures are labeled if the API is unavailable.

### T6 — Issuer failure, pause, blocklist, upgrade
*Attack / accident:* an issuer pauses its token, blocklists the vault or router, or upgrades the beacon to hostile code.
*Impact:* that representation is frozen inside the vault: `redeemInKind` for holders who want everything reverts, `redeemInKindSkipping` lets them exit with everything else and forfeit the frozen slice to remaining holders; `redeem` legs that sell the frozen token fail; `migrate` out of it fails. Other constituents and other representations are unaffected. If the router is blocklisted, single-stock buys of that representation fail at the transfer step (no funds at risk, transaction reverts).
*Bounds:* issuer caps limit the frozen share of any constituent to `maxIssuerBps` when two issuers are eligible; today most Mag 7 names have a single liquid issuer, so caps are 100 % and the UI says "single issuer". Beacon upgrades are monitored by the keeper (event on the beacon) and surfaced in the UI.

### T7 — MEV and sandwiching
*Attack:* front-run a buy/mint to worsen the fill.
*Bounds:* `minShares` (shares, not tokens), `maxUsdtIn`, `minUsdtOut`, `minShareGain` cap the damage to the caller's tolerance; resolver default tolerance is 50 bps and the quote is re-simulated right before sending. Roadmap: private RPC / Binance MEV-protected broadcast for the web app.

### T8 — Reentrancy
Every external state-changing function on router, vault and mandate is `nonReentrant`; token transfers happen after accounting; legs call allowlisted routers only. Tested with a reentering venue (`REENTER` mode).

### T9 — Approval leftovers
`forceApprove(maxIn)` then `forceApprove(0)` around every leg; the mandate approves the router/basket for exactly the authorized amount and resets to zero. Tested: `testFuzz_normal_deltasMatch` asserts allowance 0 after execution.

### T10 — Rounding
Shares credited round **down** (`sharesForTokens`); tokens required round **up** (`tokensForShares`, `requiredShares`); pro-rata payouts round **down**. Direction always favors the vault, so dust accrues to remaining holders and can never create a deficit. Fuzzed in `ShareMath.t.sol`.

### T11 — Agent key compromise
*Attack:* an attacker steals the MCP server's agent key.
*Bounds:* the key can only call `AgentMandate`; outputs go to the owner; spend is capped per tx and per 24h; only allowlisted underlyings/baskets; owner revokes instantly. The worst case is bad execution (within `minShares`) of at most the daily cap into assets the owner already approved.
*Tests:* A1–A4 and the mandate invariant suite.

### T12 — Donation / inflation attacks on the vault
Donating representation tokens or USDT to the vault only increases backing and is distributed pro rata; it cannot manipulate unit pricing because units are defined in shares, not NAV. First-depositor attacks do not apply (no share-price math).

### T13 — Registry list growth / gas
`heldShares` and `_proRataHoldings` loop over every registered representation of every constituent. With 7 constituents × 2–3 representations this is ~20 balance reads. Adding many representations per underlying raises gas linearly; ADMIN should deprecate rather than add without limit. No unbounded user-controlled loops exist.

## Slither

Run: `slither . --filter-paths "lib/|test/|script/|mocks/" --exclude-informational --exclude-low --exclude-optimization` (v0.11.4). 16 medium/low results, none high. Disposition:

| Detector | Location | Disposition |
|---|---|---|
| arbitrary-from in `transferFrom` | `AgentMandate.agentBuyShares/agentMintBasket` pull USDT from `m.owner` | **Intended.** The owner created the mandate and approved this contract; only the owner-designated agent can trigger it, within caps. |
| dangerous strict equality (`== 0`) | balance/amount zero checks in vault, executor | Zero checks on amounts, not on external state comparisons. Safe. |
| uninitialized local variables | accumulators (`held`, `count`, `k`, `eligible`, `platformShares`, `soldTotal`) | Solidity zero-initializes; accumulators are intentionally 0. |
| unused return | `agentMintBasket` ignores `mint` return (spend measured by balance delta); `ratioOf` tuple partially used; `_executeSellLeg` ignores `received` (USDT measured by delta) | Intentional: balance deltas are the source of truth. |

No findings required code changes. Re-run before mainnet deployment.
