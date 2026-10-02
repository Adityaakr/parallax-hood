# @parallax-hood/mcp: the Parallax MCP server

Exposes Parallax to Claude (Desktop, Code) and any MCP client. Transport: **stdio** (default) or **streamable HTTP** (`--http`, `http://127.0.0.1:4110/mcp`).

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `get_network()` | read | Which network this server acts on (mainnet, testnet, local), its explorer, and what on it is mocked. Call it first. |
| `search_stocks(query?)` | read | Underlyings with every representation: issuer, the token's on-chain share ratio and any scheduled change, eligibility, Chainlink reference price per share, USDG depth in its Uniswap pools. Data sources labeled. |
| `resolve_stock(ticker, usd_amount, side?, policy?, wallet?)` | read | Ranked candidates with reasons, chosen route (legs/split), share-denominated `minShares`, unsigned `ShareRouter` tx (only if it passed simulation), `quote_hash`. |
| `list_baskets()` / `get_basket(basket)` | read | NAV (display), backing ratio (must be at least 1.00), composition per constituent. |
| `quote_basket_mint(basket, units \| usd_amount, policy?)` | read | Per-constituent fills, `maxUsdgIn`, simulation, unsigned `BasketVault.mint` tx, `quote_hash`. |
| `quote_basket_redeem(basket, units, in_kind?)` | read | Best exit per representation or pro-rata in kind, `minUsdgOut`, unsigned tx. |
| `get_mandate(id)` | read | Onchain caps, spend in the 24h window, remaining, expiry, active. |
| `build_create_mandate(owner, agent?, caps, allowed, expiry)` | read | Unsigned txs for the **owner** to sign (create + USDG approval). |
| `get_receipts(filters)` | read | Indexed `RouteReceipt`s (buy/sell/mint/redeem/migrate). |
| `explain_receipt(tx_hash)` | read | Receipts and their scoring records: a plain-language "why this route", and which invariant the contract enforced. |
| `execute_with_mandate(mandate_id, action, params, dry_run?)` | **write** | Signs with the server's agent key and calls **only** `AgentMandate.agentBuyShares` / `agentMintBasket`. Refuses anything outside the mandate before sending, simulates, then sends. Outputs go to the owner. |

### Safety rules (enforced in code)
- The HTTP transport has no authentication and binds to `127.0.0.1` unless `MCP_HOST` says otherwise. Anyone who can reach it can use the agent key within its mandates, so put it behind something that authenticates before exposing it.
- The server never holds owner keys. The optional `AGENT_PRIVATE_KEY` can only act through `AgentMandate`; the contract hardcodes recipient = owner and enforces per-tx cap, daily cap, expiry, allowlists and instant revocation.
- Every write simulates first (`eth_estimateGas` from the agent) and returns the simulation result; failures are returned as errors with the decoded custom error.
- Every response that builds a transaction includes the `quote_hash`; the resolver serves the full scoring record at `GET /quotes/:hash`.
- Soft policy (premium against the Chainlink price, a tighter premium while that price is not updating over the weekend, slippage, issuer preferences) is layered on top via env defaults and per-call `policy`.
- Amounts are decimal strings in whole USDG ("50.25"); the server converts to and from USDG's 6 decimals.
- Robinhood Stock Tokens are not available to U.S. persons or in restricted jurisdictions; `get_network` says so in its response.

## Run

```
# needs a resolver (RESOLVER_URL, default http://127.0.0.1:4100) and a deployment for CHAIN_ID
pnpm --filter @parallax-hood/mcp build
CHAIN_ID=46630 RESOLVER_URL=http://127.0.0.1:4100 AGENT_PRIVATE_KEY=0x... node apps/mcp/dist/index.js       # stdio
CHAIN_ID=46630 RESOLVER_URL=http://127.0.0.1:4100 node apps/mcp/dist/index.js --http                        # HTTP on :4110
```

Environment: `CHAIN_ID` (4663 Robinhood Chain, 46630 its testnet, 31337 local fork, 1337 local mocks), `RPC_URL` (optional override), `RESOLVER_URL`, `AGENT_PRIVATE_KEY` (optional; without it the write tool refuses and you sign in your own wallet), `MCP_MAX_PREMIUM_BPS` (100), `MCP_MAX_CLOSED_MARKET_PREMIUM_BPS` (50), `MCP_MAX_SLIPPAGE_BPS` (50), `MCP_PREFER_PLATFORMS`, `MCP_EXCLUDE_PLATFORMS`.

## Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "parallax": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/parallax/apps/mcp/dist/index.js"],
      "env": {
        "CHAIN_ID": "46630",
        "RESOLVER_URL": "http://127.0.0.1:4100",
        "AGENT_PRIVATE_KEY": "0x<agent key that only holds gas>"
      }
    }
  }
}
```

## Claude Code

```
claude mcp add parallax -e CHAIN_ID=46630 -e RESOLVER_URL=http://127.0.0.1:4100 -e AGENT_PRIVATE_KEY=0x... -- node /ABSOLUTE/PATH/parallax/apps/mcp/dist/index.js
# or over HTTP
claude mcp add --transport http parallax http://127.0.0.1:4110/mcp
```

`.mcp.json` (project-scoped) equivalent:

```json
{
  "mcpServers": {
    "parallax": {
      "command": "node",
      "args": ["apps/mcp/dist/index.js"],
      "env": { "CHAIN_ID": "46630", "RESOLVER_URL": "http://127.0.0.1:4100" }
    }
  }
}
```

## Try it

- "Which network are you on, and is anything mocked?" calls `get_network`.
- "Search NVDA: how many shares is one token, and how deep is the pool?" calls `search_stocks`.
- "Buy 100 USDG of NVDA at no more than 60 bps over the Chainlink price." calls `resolve_stock`, then `execute_with_mandate` with a mandate id, or you sign the returned transaction yourself.
- "Mint one unit of pxMAG7 under mandate 1." calls `quote_basket_mint`, then `execute_with_mandate`.
- "Why did that trade take the route it took?" calls `explain_receipt`.
