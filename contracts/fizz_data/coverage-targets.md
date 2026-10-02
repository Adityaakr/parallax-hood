# Coverage targets

Fuzz profile: via_ir required (stack too deep in `BasketVault.migrate` without IR), optimizer_runs=0 — coverage deflated ~10%, targets adjusted.

| Contract | Role | Target |
|---|---|---|
| BasketVault | core protocol logic | 70% |
| ShareRouter | core execution | 70% |
| AgentMandate | core delegation | 70% |
| StockRegistry | registry / access control | 50% |
| LegExecutor / ShareMath / ReceiptEmitter | libraries | inherited |
| BasketFactory | one-shot factory (createBasket in setup only) | n/a |

Known unreachable in the harness: `StockRegistry.setPriceFeed` / `referencePrice` feed branch (no Chainlink mock in scope — covered by unit tests), `addRepresentation`/`setUnderlying` beyond setup, role management, `LegExecutor` REENTER/TAKE_MORE venue modes (fuzz/unit tests cover them).

## Cycle 1 (2026-09-21 00:1x)

| Contract | Role | Target | Hit | Status |
|---|---|---|---|---|
| BasketVault | core | 70% | 84% | ✅ |
| ShareRouter | core | 70% | 96% | ✅ |
| AgentMandate | core | 70% | 60% | ❌ |
| StockRegistry | registry | 50% | 84% | ✅ |
| LegExecutor / ReceiptEmitter / ShareMath | libs | inherited | 100 / 100 / 86% | ✅ |
| BasketFactory | one-shot | n/a | 63% | — |

Findings: 2 harness-side failures ("B1: backing holds after redeem") — issuer multiplier / keeper ratio drift
between calls broke backing before the redeem; property restated as "a burn never lowers the backing ratio".
AgentMandate: the agent paths never completed because Medusa's default time jumps (up to 7 days per call)
aged out attestations (36 h) and reference prices; added `stockRegistry_keeperRefresh` and capped
`blockTimestampDelayMax` at 12 h.

## Cycle 2 (2026-09-21)

| Contract | Role | Target | Hit | Status |
|---|---|---|---|---|
| BasketVault | core | 70% | 85% | ✅ |
| ShareRouter | core | 70% | 96% | ✅ |
| AgentMandate | core | 70% | 93% | ✅ |
| StockRegistry | registry | 50% | 84% | ✅ |
| LegExecutor / ReceiptEmitter / ShareMath | libs | inherited | 100 / 100 / 86% | ✅ |
| BasketFactory | one-shot (createBasket runs once in setup; revert paths are unit-tested) | n/a | 63% | — |

All targets met. One harness-side failure: "B6: vault keeps no mint USDG beyond donations" compared the vault's
USDG to donations only, but the vault legitimately holds USDG from migration residue and forfeited in-kind
slices (`redeemInKindSkipping` with USDG skipped). Restated as "a mint does not change vault USDG".
