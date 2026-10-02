# @parallax-hood/mcp — Parallax MCP server

Exposes Parallax to Claude (Desktop, Code) and any MCP client. Transport: **stdio** (default) or **streamable HTTP** (`--http`, `http://127.0.0.1:4010/mcp`).

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `search_stocks(query?)` | read | Underlyings with every BSC representation: issuer, ratio + source, attestation age, eligibility, reference price, market status. Data sources labeled. |
| `resolve_stock(ticker, usd_amount, side?, policy?, wallet?)` | read | Ranked candidates with reasons, chosen route (legs/split), share-denominated `minShares`, unsigned `ShareRouter` tx (only if it passed simulation), `quote_hash`. |
| `list_baskets()` / `get_basket(basket)` | read | NAV (display), backing ratio (must be ≥ 1.00), issuer mix vs caps, migration opportunities. |
| `quote_basket_mint(basket, units \| usd_amount, policy?)` | read | Per-constituent fills across issuers under caps, `maxUsdtIn`, simulation, unsigned `BasketVault.mint` tx, `quote_hash`. |
| `quote_basket_redeem(basket, units, in_kind?)` | read | Best exit per representation or pro-rata in kind, `minUsdtOut`, unsigned tx. |
| `get_mandate(id)` | read | Onchain caps, spend in the 24h window, remaining, expiry, active. |
| `build_create_mandate(owner, agent?, caps, allowed, expiry)` | read | Unsigned txs for the **owner** to sign (create + USDT approval). |
| `get_receipts(filters)` | read | Indexed `RouteReceipt`s (buy/sell/mint/redeem/migrate). |
| `explain_receipt(tx_hash)` | read | Receipts + their scoring records → plain-language "why this route", and which invariant the contract enforced. |
| `execute_with_mandate(mandate_id, action, params, dry_run?)` | **write** | Signs with the server's agent key and calls **only** `AgentMandate.agentBuyShares` / `agentMintBasket`. Refuses anything outside the mandate before sending, simulates, then sends. Outputs go to the owner. |

### Safety rules (enforced in code)
- The server never holds owner keys. The optional `AGENT_PRIVATE_KEY` can only act through `AgentMandate`; the contract hardcodes recipient = owner and enforces per-tx cap, daily cap, expiry, allowlists and instant revocation.
- Every write simulates first (`eth_estimateGas` from the agent) and returns the simulation result; failures are returned as errors with the decoded custom error.
- Every response that builds a transaction includes the `quote_hash`; the resolver serves the full scoring record at `GET /quotes/:hash`.
- Soft policy (attestation age, closed-market deviation, slippage, issuer preferences) is layered on top via env defaults and per-call `policy`.

## Run

```
# needs a resolver (RESOLVER_URL, default http://127.0.0.1:4000) and a deployment for CHAIN_ID
pnpm --filter @parallax-hood/mcp build
CHAIN_ID=56 RESOLVER_URL=http://127.0.0.1:4000 AGENT_PRIVATE_KEY=0x... node apps/mcp/dist/index.js          # stdio
CHAIN_ID=56 RESOLVER_URL=http://127.0.0.1:4000 node apps/mcp/dist/index.js --http                           # HTTP on :4010
```

Environment: `CHAIN_ID` (56 mainnet, 97 testnet, 31337 local fork, 1337 local mocks), `RPC_URL` (optional override), `RESOLVER_URL`, `AGENT_PRIVATE_KEY` (optional; without it the write tool refuses and you sign in your own wallet), `MCP_MAX_ATTESTATION_AGE_HOURS` (36), `MCP_MAX_PREMIUM_BPS` (100), `MCP_MAX_CLOSED_MARKET_PREMIUM_BPS` (50), `MCP_MAX_SLIPPAGE_BPS` (50), `MCP_PREFER_PLATFORMS`, `MCP_EXCLUDE_PLATFORMS`.

## Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "parallax": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/parallax/apps/mcp/dist/index.js"],
      "env": {
        "CHAIN_ID": "56",
        "RESOLVER_URL": "http://127.0.0.1:4000",
        "AGENT_PRIVATE_KEY": "0x<agent key that only holds gas>"
      }
    }
  }
}
```

## Claude Code

```
claude mcp add parallax -e CHAIN_ID=56 -e RESOLVER_URL=http://127.0.0.1:4000 -e AGENT_PRIVATE_KEY=0x... -- node /ABSOLUTE/PATH/parallax/apps/mcp/dist/index.js
# or over HTTP
claude mcp add --transport http parallax http://127.0.0.1:4010/mcp
```

`.mcp.json` (project-scoped) equivalent:

```json
{
  "mcpServers": {
    "parallax": {
      "command": "node",
      "args": ["apps/mcp/dist/index.js"],
      "env": { "CHAIN_ID": "56", "RESOLVER_URL": "http://127.0.0.1:4000" }
    }
  }
}
```

## Try it

- "Search NVDA and compare the representations."
- "Buy $100 of NVDA with max 60 bps premium and attestations under 36h." → `resolve_stock` (then `execute_with_mandate` with a mandate id, or sign the returned tx yourself)
- "Mint 1 unit of pxMAG7." → `quote_basket_mint`
- "Explain this receipt 0x…" → `explain_receipt`

Tested end to end with the official MCP client over stdio in `test/mcp.e2e.test.ts` (buy through a mandate, mint through a mandate, per-tx/daily cap refusals, allowlist refusal, revocation).
