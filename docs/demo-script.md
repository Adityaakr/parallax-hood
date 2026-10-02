# Demo script (3 minutes, ≤ 4 min video)

Setup before recording: resolver on mainnet (`CHAIN_ID=56`), keeper in the background, MCP connected to Claude Code (`claude mcp add parallax …`, see `apps/mcp/README.md`), web app on `:3100` with network = BSC mainnet, a wallet with ~$100 USDT and a mandate created for the MCP agent key (per-tx $50, daily $100, NVDA + pxMAG7 allowed). Have a second terminal ready for the guardrail failures. If the market is closed, the closed-market queue in step 2 is a feature, not a problem.

## 1 · Problem (20s)
Web app home → search **NVDA**. Point at the two rows: **NVDAB** (bStocks, ratio 1.0008 read onchain, attestation age) and **NVDAon** (Ondo, ratio 1.0037 keeper-posted). Same company, different tokens, ratios, venues and attestations.
> "Which one should a user, an index, or an agent buy? You shouldn't have to know."

## 2 · Resolve (40s)
In Claude Code with the Parallax MCP: **"Buy $100 of NVDA, max 60 bps premium, attestations under 36h."**
Claude calls `resolve_stock` → show the ranked table: cost per **share**, premium vs Chainlink, slippage, attestation age, and the reason NVDAon is excluded (no contract-executable liquidity / premium). Then `execute_with_mandate` → tx hash on BSC.
Open `/receipts`, click **why** on the new receipt: the scoring record behind the fill, linked by `quoteHash`.

## 3 · Basket (50s)
`/baskets/pxMAG7`: NAV (display only), **backing ratio ≥ 1.00 on every constituent**, issuer bars vs caps ("single issuer" where only bStocks is liquid). Mint **1 unit**: the quote shows seven fills, expected vs max USDT (unused is refunded), simulation ok. Sign. Watch backing stay ≥ 1.00 and seven receipts appear.

## 4 · Migrate (30s)
Same page, *Migration opportunities*. If one exists: click **Migrate** and show the constituent's held shares go up while every other row is unchanged.
If none exists today (likely, since Ondo's AMM depth is thin): show the fork test `testFork_migrate_ondoToBstock_gainsShares` output, "migration not accretive at this block; correctly rejected", and the unit test where a 2 % cheaper representation *is* migrated. Anyone can improve the basket; nobody can hurt it.

## 5 · Guardrails (30s)
- Ask Claude to buy **$500** with the same mandate → `execute_with_mandate` refuses: "exceeds per-tx cap 50" (checked offchain, enforced onchain).
- Set the policy to disallow closed-market execution (or wait for the close) → status **queued_until_open** with the next open time.
- `/mandates` → **Revoke**. Ask the agent again → "mandate revoked".

## 6 · Close (10s)
> "Index products for tokenized stocks, where every share is filled at its best representation, under rules an agent can't break."

Fallbacks: if BSC RPC is slow, run the same script on the local fork (`pnpm fork:up`, `CHAIN_ID=31337`): same tokens, same pools, no gas cost, and say so on screen.
