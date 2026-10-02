import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createPublicClient, createWalletClient, http, type Address, type Hex, encodeFunctionData, isAddress, getAddress, decodeErrorResult, type PublicClient, type WalletClient, type Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AgentMandateAbi, ShareRouterAbi, BasketVaultAbi, Erc20Abi, CHAINS, NETWORK_LABEL, chainIdToNetwork, tickerToId, formatWad, formatUsdg, parseUsdg, deserializeLegs } from "@parallax-hood/sdk";

export type McpConfig = {
  resolverUrl: string;
  chainId: number;
  rpcUrl: string;
  mandateAddress: Address;
  routerAddress: Address;
  usdg: Address;
  agentPrivateKey?: Hex;
  /** Soft policy defaults layered on top of onchain mandates. */
  softPolicy: { maxPremiumBps: number; maxClosedMarketPremiumBps: number; maxSlippageBps: number; preferPlatforms: string[]; excludePlatforms: string[] };
};

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2) }] });
const err = (msg: string) => ({ isError: true, content: [{ type: "text" as const, text: msg }] });

const PolicyIn = z
  .object({
    maxAttestationAgeHours: z.number().positive().optional().describe("Only for a registry that requires issuer attestations (Robinhood Chain's does not): exclude representations whose attestation is older than this (hours)."),
    maxPremiumBps: z.number().int().optional().describe("Max effective premium vs reference price while the market is open, in bps (includes gas)."),
    maxClosedMarketPremiumBps: z.number().int().optional().describe("Max premium while the reference price is not updating (Friday 20:00 to Sunday 20:00 New York time), in bps."),
    maxSlippageBps: z.number().int().min(0).max(10000).optional().describe("Max slippage vs marginal price, bps. Also sets minShares = sharesOut * (1 - this)."),
    maxIssuerBps: z.number().int().min(0).max(10000).optional().describe("Max share of your holdings of this underlying with a single issuer after the trade."),
    preferPlatforms: z.array(z.string()).optional().describe("Issuer ids to prefer on a near tie, e.g. ['robinhood']."),
    excludePlatforms: z.array(z.string()).optional().describe("Issuer ids to exclude."),
    allowClosedMarket: z.boolean().optional().describe("Allow execution over the weekend, when the reference price is not updating (subject to maxClosedMarketPremiumBps)."),
  })
  .optional();

export function buildServer(cfg: McpConfig) {
  const network = chainIdToNetwork(cfg.chainId);
  const chain = CHAINS[network];
  const pub: PublicClient = createPublicClient({ chain, transport: http(cfg.rpcUrl) });
  const agent: Account | undefined = cfg.agentPrivateKey ? privateKeyToAccount(cfg.agentPrivateKey) : undefined;
  const wallet: WalletClient | undefined = agent ? createWalletClient({ account: agent, chain, transport: http(cfg.rpcUrl) }) : undefined;

  const api = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${cfg.resolverUrl}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    const body = await res.json();
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `resolver ${res.status}`);
    return body as any;
  };
  const policy = (p?: z.infer<typeof PolicyIn>) => ({ ...cfg.softPolicy, ...(p ?? {}) });

  /** Which network this server acts on and what on it is a stand-in, attached to every response that matters. */
  const label = { ...NETWORK_LABEL[network], chainId: cfg.chainId };
  const networkInfo = async () => {
    try {
      const h = await api("/health");
      return h.label ?? label;
    } catch {
      return label;
    }
  };

  /**
   * Plan an action THROUGH an AgentMandate for the key that will sign it. Refuses everything the contract
   * would refuse before any signer is involved: wrong agent, inactive, expired, caps, allowlists.
   */
  type MandateParams = { ticker?: string; usd_amount?: string; basket?: string; units?: string; usd?: string; policy?: z.infer<typeof PolicyIn> };
  type Planned = { refused: string } | { data: Hex; plan: unknown; quoteHash: Hex; m: { owner: Address; agent: Address; perTxCapUsdg: bigint; dailyCapUsdg: bigint } };
  async function planMandate(p: { mandateId: string; action: "buy_shares" | "mint_basket"; params: MandateParams; signer: Address }): Promise<Planned> {
    const id = BigInt(p.mandateId);
    const m = await pub.readContract({ address: cfg.mandateAddress, abi: AgentMandateAbi, functionName: "getMandate", args: [id] });
    const now = Math.floor(Date.now() / 1000);
    const refusals: string[] = [];
    if (m.owner === "0x0000000000000000000000000000000000000000") return { refused: `mandate ${p.mandateId} does not exist` };
    if (m.agent.toLowerCase() !== p.signer.toLowerCase()) refusals.push(`mandate agent is ${m.agent}, the signer is ${p.signer}`);
    if (!m.active) refusals.push("mandate revoked");
    if (Number(m.expiry) <= now) refusals.push(`mandate expired at ${new Date(Number(m.expiry) * 1000).toISOString()}`);
    const remaining = await pub.readContract({ address: cfg.mandateAddress, abi: AgentMandateAbi, functionName: "remainingDaily", args: [id] });
    let data: Hex, quoteHash: Hex, plan: unknown;
    if (p.action === "buy_shares") {
      if (!p.params.ticker || !p.params.usd_amount) return { refused: "buy_shares needs ticker and usd_amount" };
      const amount = parseUsdg(p.params.usd_amount);
      const uid = tickerToId(p.params.ticker.toUpperCase());
      const allowed = await pub.readContract({ address: cfg.mandateAddress, abi: AgentMandateAbi, functionName: "allowedUnderlying", args: [id, uid] });
      if (!allowed) refusals.push(`${p.params.ticker.toUpperCase()} is not on this mandate's allowlist`);
      if (amount > m.perTxCapUsdg) refusals.push(`${p.params.usd_amount} USDG exceeds per-tx cap ${formatUsdg(m.perTxCapUsdg)}`);
      if (amount > remaining) refusals.push(`${p.params.usd_amount} USDG exceeds remaining daily cap ${formatUsdg(remaining)}`);
      if (refusals.length) return { refused: `refused by mandate policy: ${refusals.join("; ")}` };
      const r = await api("/resolve", { method: "POST", body: JSON.stringify({ ticker: p.params.ticker, side: "buy", usdAmount: p.params.usd_amount, policy: policy(p.params.policy), wallet: m.owner, recipient: m.owner }) });
      if (r.status !== "ok" || !r.chosen) return { refused: `no route: ${r.status}. ${r.candidates.map((c: any) => `${c.symbol}: ${c.reasons.join("; ") || "ok"}`).join(" | ")}` };
      // the router pulls the notional plus the protocol fee; the mandate authorizes that total
      const total = BigInt(r.fee?.totalUsdgIn ?? amount);
      if (total > m.perTxCapUsdg) return { refused: `${formatUsdg(total, 2)} USDG incl. fee exceeds per-tx cap ${formatUsdg(m.perTxCapUsdg)}` };
      if (total > remaining) return { refused: `${formatUsdg(total, 2)} USDG incl. fee exceeds remaining daily cap ${formatUsdg(remaining)}` };
      quoteHash = r.quoteHash;
      data = encodeFunctionData({ abi: AgentMandateAbi, functionName: "agentBuyShares", args: [id, uid, total, BigInt(r.chosen.minShares), deserializeLegs(r.chosen.legs), quoteHash] });
      plan = summarizeResolve(r);
    } else {
      if (!p.params.basket || (!p.params.units && !p.params.usd)) return { refused: "mint_basket needs basket and units (or usd)" };
      const q = await api(`/baskets/${encodeURIComponent(p.params.basket)}/quote-mint`, { method: "POST", body: JSON.stringify({ units: p.params.units, budgetUsdg: p.params.usd, policy: policy(p.params.policy), wallet: m.owner, recipient: m.owner }) });
      if (q.status !== "ok") return { refused: `no route: ${q.problems.join("; ")}` };
      const basket = getAddress(q.basket);
      const allowed = await pub.readContract({ address: cfg.mandateAddress, abi: AgentMandateAbi, functionName: "allowedBasket", args: [id, basket] });
      if (!allowed) refusals.push(`basket ${q.symbol} is not on this mandate's allowlist`);
      const amount = BigInt(q.maxUsdgIn);
      if (amount > m.perTxCapUsdg) refusals.push(`maxUsdgIn ${formatUsdg(amount, 2)} exceeds per-tx cap ${formatUsdg(m.perTxCapUsdg)}`);
      if (amount > remaining) refusals.push(`maxUsdgIn ${formatUsdg(amount, 2)} exceeds remaining daily cap ${formatUsdg(remaining)}`);
      if (refusals.length) return { refused: `refused by mandate policy: ${refusals.join("; ")}` };
      quoteHash = q.quoteHash;
      data = encodeFunctionData({ abi: AgentMandateAbi, functionName: "agentMintBasket", args: [id, basket, BigInt(q.units), amount, deserializeLegs(q.legs), quoteHash] });
      plan = { basket: q.symbol, units: formatWad(BigInt(q.units), 6), expectedUsdg: formatUsdg(BigInt(q.expectedUsdg), 4), maxUsdgIn: formatUsdg(amount, 4), breakdown: q.breakdown.map((b: any) => ({ ticker: b.ticker, fills: b.fills.map((f: any) => `${f.symbol} ${formatWad(BigInt(f.shares), 6)} sh @ ${f.costPerShareUsd} (${f.premiumBps} bps)`) })) };
    }
    return { data, plan, quoteHash, m };
  }

  const explain = (e: unknown) => {
    const msg = String((e as Error)?.message ?? e);
    const m = /custom error (0x[0-9a-fA-F]{8}):?\s*([0-9a-fA-F]*)/.exec(msg) ?? /data:\s*(0x[0-9a-fA-F]{8})([0-9a-fA-F]*)/.exec(msg);
    if (m) {
      try {
        const d = decodeErrorResult({ abi: [...AgentMandateAbi, ...ShareRouterAbi, ...BasketVaultAbi], data: `${m[1]}${m[2] ?? ""}` as Hex });
        return `${d.errorName}(${(d.args ?? []).map(String).join(", ")})`;
      } catch {
        /* unknown */
      }
    }
    return msg.split("\n")[0]!.slice(0, 300);
  };

  const server = new McpServer({ name: "parallax", version: "0.1.0" }, {
    instructions:
      `Parallax on Robinhood Chain (this server: ${label.name}, chain ${cfg.chainId}, ${label.kind}). It buys Robinhood stock tokens through Uniswap v3 measured in underlying shares, ` +
      "not tokens: each token carries an on-chain multiplier, and every quote, minimum and receipt is in shares. It also manages USDG-settled index vaults whose unit is a fixed number of shares (pxMAG7, pxAI). " +
      "USDG has 6 decimals; amounts in tool inputs and outputs are decimal strings in whole USDG. Read tools return ranked candidates with reasons and a quote_hash that links the onchain receipt to its scoring record. " +
      "The only write tool is execute_with_mandate: it signs with the configured agent key and can only act through the AgentMandate contract, " +
      "so per-tx caps, daily caps, expiry and allowlists are enforced onchain and outputs always go to the mandate owner. It simulates before sending. " +
      "Call get_network first: on a test network the stock tokens, USDG, venue and prices are mocks, and a result there says nothing about a real market. " +
      "Robinhood Stock Tokens are not available to U.S. persons or in restricted jurisdictions. Not investment advice; unaudited software.",
  });

  // ------------------------------------------------------------------
  // Read tools
  // ------------------------------------------------------------------

  server.registerTool("get_network", {
    title: "Which network, and what on it is mocked",
    description: "The network this server acts on (Robinhood Chain mainnet, the testnet or a local chain), its chain id and explorer, and the list of things that are mocks there. Empty `mocked` means real tokens, real USDG, real Uniswap pools and Chainlink prices.",
    inputSchema: {},
  }, async () => text({ ...(await networkInfo()), mandateContract: cfg.mandateAddress, usdg: cfg.usdg, usdgDecimals: 6, agent: agent?.address ?? null, eligibility: "Robinhood Stock Tokens may not be offered or sold to U.S. persons, and are restricted in other jurisdictions including Canada, the United Kingdom and Switzerland." }));

  server.registerTool("search_stocks", {
    title: "Search stocks",
    description: "List underlyings (e.g. NVDA) with every tokenized representation: issuer, token address, share ratio (the token's on-chain multiplier) and any scheduled change to it, buy/sell eligibility, Chainlink reference price per share, USDG depth in its Uniswap pools and whether the reference price is currently updating. Data sources are labeled (live vs fixture).",
    inputSchema: { query: z.string().optional().describe("Ticker or symbol substring, e.g. 'NVDA' or 'TSLA'. Empty lists everything.") },
  }, async ({ query }) => {
    const r = await api(`/stocks${query ? `?query=${encodeURIComponent(query)}` : ""}`);
    return text(r);
  });

  server.registerTool("resolve_stock", {
    title: "Resolve a stock buy or sell",
    description:
      "Score every representation of an underlying for a buy of usd_amount USDG (or a sell), apply the policy, and return ranked candidates with plain-language reasons, the chosen route (legs, split), the share-denominated minShares, an unsigned ShareRouter transaction (only if it passed simulation), and the quote_hash. Amounts are decimal strings.",
    inputSchema: {
      ticker: z.string().describe("Underlying ticker, e.g. NVDA"),
      usd_amount: z.string().describe("USDG amount as a decimal string, e.g. '50'"),
      side: z.enum(["buy", "sell"]).default("buy"),
      policy: PolicyIn,
      wallet: z.string().optional().describe("Wallet that will sign (for simulation, approval check and issuer-cap on holdings). Defaults to the agent's mandate owner if set later; optional."),
      representation: z.string().optional().describe("Sell only: the token address to sell"),
    },
  }, async ({ ticker, usd_amount, side, policy: p, wallet: w, representation }) => {
    const r = await api("/resolve", { method: "POST", body: JSON.stringify({ ticker, side, usdAmount: usd_amount, policy: policy(p), wallet: w, representation }) });
    return text(summarizeResolve(r));
  });

  server.registerTool("list_baskets", {
    title: "List baskets",
    description: "All Parallax indices with NAV per unit (display only), period returns from Chainlink rounds (with coverageBps: the share of NAV that has a feed), minimum investment in USD, allocation by value, and whether the index is deployed on this network.",
    inputSchema: {},
  }, async () => text(await api("/baskets")));

  server.registerTool("get_basket", {
    title: "Get basket",
    description: "Basket detail: composition per constituent and representation, backing ratio (held/required, must be >= 1.00), issuer caps vs actual, and current share-accretive migration opportunities.",
    inputSchema: { basket: z.string().describe("Basket symbol (pxMAG7) or address") },
  }, async ({ basket }) => text(await api(`/baskets/${encodeURIComponent(basket)}`)));

  server.registerTool("quote_basket_mint", {
    title: "Quote basket mint",
    description: "Quote minting `units` (or usd_amount worth) of a basket: per-constituent fills across issuers under caps, expected USDG, maxUsdgIn, legs, simulation result, unsigned BasketVault.mint transaction and quote_hash.",
    inputSchema: {
      basket: z.string(),
      units: z.string().optional().describe("Basket units as a decimal string, e.g. '1'"),
      usd_amount: z.string().optional().describe("Alternative: the USDG budget to spend; units are sized so maxUsdgIn stays within it"),
      policy: PolicyIn,
      wallet: z.string().optional(),
    },
  }, async ({ basket, units, usd_amount, policy: p, wallet: w }) => {
    const r = await api(`/baskets/${encodeURIComponent(basket)}/quote-mint`, { method: "POST", body: JSON.stringify({ units, budgetUsdg: usd_amount, policy: policy(p), wallet: w }) });
    return text({ ...r, legs: undefined, tx: r.tx ? { to: r.tx.to, data_bytes: (r.tx.data.length - 2) / 2, gas: r.tx.gas } : null, legsCount: r.legs?.length });
  });

  server.registerTool("quote_basket_redeem", {
    title: "Quote basket redeem",
    description: "Quote redeeming `units` of a basket to USDG through the best exit per representation, or in kind (pro-rata tokens, always available, no oracle). Returns slices, minUsdgOut, unsigned transaction and quote_hash.",
    inputSchema: { basket: z.string(), units: z.string(), in_kind: z.boolean().default(false), policy: PolicyIn, wallet: z.string().optional() },
  }, async ({ basket, units, in_kind, policy: p, wallet: w }) => {
    const r = await api(`/baskets/${encodeURIComponent(basket)}/quote-redeem`, { method: "POST", body: JSON.stringify({ units, inKind: in_kind, policy: policy(p), wallet: w }) });
    return text({ ...r, legs: undefined, tx: r.tx ? { to: r.tx.to, data_bytes: (r.tx.data.length - 2) / 2 } : null });
  });

  server.registerTool("get_mandate", {
    title: "Get mandate",
    description: "Read an AgentMandate: owner, agent, per-tx and daily caps (USDG), max slippage vs reference price (bps), spent in the current 24h window, remaining today, expiry, active flag.",
    inputSchema: { id: z.string().describe("Mandate id (uint)") },
  }, async ({ id }) => {
    const m = await pub.readContract({ address: cfg.mandateAddress, abi: AgentMandateAbi, functionName: "getMandate", args: [BigInt(id)] });
    const remaining = await pub.readContract({ address: cfg.mandateAddress, abi: AgentMandateAbi, functionName: "remainingDaily", args: [BigInt(id)] });
    return text({
      id, owner: m.owner, agent: m.agent, active: m.active, expiry: Number(m.expiry), expiryIso: new Date(Number(m.expiry) * 1000).toISOString(),
      perTxCapUsdg: formatUsdg(m.perTxCapUsdg), dailyCapUsdg: formatUsdg(m.dailyCapUsdg), maxSlippageBps: m.maxSlippageBps, spentInWindowUsdg: formatUsdg(m.spentInWindow), windowStart: Number(m.windowStart), remainingDailyUsdg: formatUsdg(remaining),
      isConfiguredAgent: agent ? m.agent.toLowerCase() === agent.address.toLowerCase() : false, mandateContract: cfg.mandateAddress,
    });
  });

  server.registerTool("build_create_mandate", {
    title: "Build create-mandate transaction",
    description: "Build the unsigned transaction the OWNER signs to create an AgentMandate for an agent address with hard onchain limits. Also returns the USDG approval the owner must grant to the mandate contract.",
    inputSchema: {
      owner: z.string().describe("Owner wallet (signs this tx; receives all outputs)"),
      agent: z.string().optional().describe("Agent address. Defaults to this server's configured agent key."),
      per_tx_cap_usdg: z.string().describe("Per-transaction cap in USDG, decimal string"),
      daily_cap_usdg: z.string().describe("Daily (24h window) cap in USDG"),
      expiry_iso: z.string().describe("ISO date/time when the mandate expires"),
      max_slippage_bps: z.number().int().min(1).max(2000).default(300).describe("Worst execution the agent may accept, bps below the registry's reference price (Chainlink), fees included. Enforced onchain per trade; 1-2000."),
      allowed_tickers: z.array(z.string()).default([]).describe("Underlyings the agent may buy, e.g. ['NVDA','AAPL']"),
      allowed_baskets: z.array(z.string()).default([]).describe("Basket addresses the agent may mint"),
    },
  }, async ({ owner, agent: a, per_tx_cap_usdg, daily_cap_usdg, expiry_iso, max_slippage_bps, allowed_tickers, allowed_baskets }) => {
    if (!isAddress(owner)) return err("owner must be an address");
    const agentAddr = a ?? agent?.address;
    if (!agentAddr || !isAddress(agentAddr)) return err("agent address required (no agent key configured)");
    const expiry = Math.floor(new Date(expiry_iso).getTime() / 1000);
    if (!Number.isFinite(expiry) || expiry <= Date.now() / 1000) return err("expiry must be a future ISO date");
    const baskets = allowed_baskets.map((b) => (isAddress(b) ? getAddress(b) : null));
    if (baskets.some((b) => b === null)) return err("allowed_baskets must be addresses");
    const data = encodeFunctionData({
      abi: AgentMandateAbi, functionName: "createMandate",
      args: [getAddress(agentAddr), parseUsdg(per_tx_cap_usdg), parseUsdg(daily_cap_usdg), BigInt(expiry), max_slippage_bps, allowed_tickers.map((t) => tickerToId(t.toUpperCase())), baskets as Address[]],
    });
    const approve = encodeFunctionData({ abi: Erc20Abi, functionName: "approve", args: [cfg.mandateAddress, parseUsdg(daily_cap_usdg)] });
    return text({
      chainId: cfg.chainId,
      createMandateTx: { from: getAddress(owner), to: cfg.mandateAddress, data, value: "0" },
      approveUsdgTx: { from: getAddress(owner), to: cfg.usdg, data: approve, value: "0", note: "approve at least the daily cap; the mandate pulls USDG from the owner per trade" },
      summary: `agent ${agentAddr} may spend up to ${per_tx_cap_usdg} USDG per tx and ${daily_cap_usdg} USDG per 24h on ${allowed_tickers.join(", ") || "no stocks"} / ${baskets.length} basket(s) until ${expiry_iso}, never worse than ${max_slippage_bps} bps below the reference price; outputs always go to ${owner}; owner can revoke instantly`,
    });
  });

  server.registerTool("get_receipts", {
    title: "Get receipts",
    description: "Indexed RouteReceipt events (buy/sell/mint/redeem/migrate) with shares and the token's ratio at execution time, filterable by actor, underlying, basket or quote_hash.",
    inputSchema: { actor: z.string().optional(), underlying: z.string().optional(), basket: z.string().optional(), quote_hash: z.string().optional(), limit: z.number().int().max(200).default(20) },
  }, async ({ actor, underlying, basket, quote_hash, limit }) => {
    const q = new URLSearchParams();
    if (actor) q.set("actor", actor);
    if (underlying) q.set("underlying", underlying);
    if (basket) q.set("basket", basket);
    if (quote_hash) q.set("quoteHash", quote_hash);
    q.set("limit", String(limit));
    return text(await api(`/receipts?${q}`));
  });

  server.registerTool("explain_receipt", {
    title: "Explain a receipt",
    description: "Fetch the RouteReceipt(s) of a transaction and their scoring records (by quote_hash) and explain in plain language why that route was chosen: candidates, premiums, slippage, policy and the invariant the contract enforced.",
    inputSchema: { tx_hash: z.string() },
  }, async ({ tx_hash }) => {
    const r = await api(`/receipts/${tx_hash}`);
    if (!r.receipts?.length) return text({ tx_hash, found: false, note: "no RouteReceipt indexed for this transaction (not a Parallax tx, or indexer not caught up)" });
    return text(explainReceipts(r));
  });

  // ------------------------------------------------------------------
  // The only write tool
  // ------------------------------------------------------------------

  server.registerTool("execute_with_mandate", {
    title: "Execute with mandate (agent key)",
    description:
      "Execute a buy_shares or mint_basket action THROUGH AgentMandate using this server's agent key. Refuses anything outside the mandate (wrong agent, inactive, expired, caps, allowlists) before sending, then simulates, then sends. Outputs go to the mandate owner. Returns tx hash, receipts and quote_hash.",
    inputSchema: {
      mandate_id: z.string(),
      action: z.enum(["buy_shares", "mint_basket"]),
      params: z.object({
        ticker: z.string().optional().describe("buy_shares: underlying ticker"),
        usd_amount: z.string().optional().describe("buy_shares: USDG to spend"),
        basket: z.string().optional().describe("mint_basket: basket symbol or address"),
        units: z.string().optional().describe("mint_basket: units to mint"),
        policy: PolicyIn,
      }),
      dry_run: z.boolean().default(false).describe("Simulate and return the plan without sending"),
    },
  }, async ({ mandate_id, action, params, dry_run }) => {
    if (!agent || !wallet) return err("no AGENT_PRIVATE_KEY configured on this MCP server; use build_create_mandate / resolve_stock and sign in your wallet instead");
    const planned = await planMandate({ mandateId: mandate_id, action, params, signer: agent.address });
    if ("refused" in planned) return err(planned.refused);
    const { data, plan, quoteHash, m } = planned;
    // simulate from the agent
    let gas: bigint;
    try {
      gas = await pub.estimateGas({ account: agent, to: cfg.mandateAddress, data });
    } catch (e) {
      return err(`simulation failed: ${explain(e)}. Plan: ${JSON.stringify(plan)}`);
    }
    const net = await networkInfo();
    if (dry_run) return text({ dryRun: true, network: net, simulation: { ok: true, gas: gas.toString() }, quoteHash, plan, to: cfg.mandateAddress, owner: m.owner, agent: agent.address });
    const hash = await wallet.sendTransaction({ account: agent, chain, to: cfg.mandateAddress, data, gas: (gas * 12n) / 10n });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    let receipts: unknown = null;
    try {
      receipts = (await api(`/receipts/${hash}`)).receipts;
    } catch {
      /* indexer may lag */
    }
    const explorer = chain.blockExplorers?.default.url;
    return text({ txHash: hash, explorerUrl: explorer ? `${explorer}/tx/${hash}` : null, network: net, status: rcpt.status, gasUsed: rcpt.gasUsed.toString(), quoteHash, owner: m.owner, agent: agent.address, plan, receipts });
  });

  return server;
}


export function summarizeResolve(r: any) {
  const cands = (r.candidates ?? []).map((c: any) => ({
    symbol: c.symbol, platform: c.platform, venue: c.venue, eligible: c.eligible,
    costPerShareUsd: c.costPerShareUsd, premiumBps: c.premiumBps, pricePremiumBps: c.pricePremiumBps, slippageBps: c.slippageBps,
    sharesOut: c.sharesOut && c.sharesOut !== "0" ? formatWad(BigInt(c.sharesOut), 6) : "0",
    ratio: c.ratio ? formatWad(BigInt(c.ratio), 6) : undefined, ratioSource: c.ratioSource,
    reasons: c.reasons,
  }));
  return {
    underlying: r.underlying, side: r.side, usdAmount: r.usdAmount, status: r.status, dataSource: r.dataSource,
    referencePrice: r.referencePrice, referenceSource: r.referenceSource, marketOpen: r.marketOpen, marketSource: r.marketSource,
    nextOpenTime: r.nextOpenTime ? new Date(r.nextOpenTime).toISOString() : null, gasUsd: r.gasUsd,
    candidates: cands,
    chosen: r.chosen ? { why: r.chosen.why, split: r.chosen.split, sharesOut: formatWad(BigInt(r.chosen.sharesOut), 6), minShares: formatWad(BigInt(r.chosen.minShares), 6), usdgIn: r.chosen.usdgIn ? formatUsdg(BigInt(r.chosen.usdgIn), 4) : undefined, usdgOut: r.chosen.usdgOut ? formatUsdg(BigInt(r.chosen.usdgOut), 4) : undefined, legs: r.chosen.legs?.length } : null,
    fee: r.fee ? { bps: r.fee.bps, usdg: formatUsdg(BigInt(r.fee.usdg), 4), totalUsdgIn: r.fee.totalUsdgIn ? formatUsdg(BigInt(r.fee.totalUsdgIn), 4) : undefined, netUsdgOut: r.fee.netUsdgOut ? formatUsdg(BigInt(r.fee.netUsdgOut), 4) : undefined, note: "protocol fee on USDG notional; none on in-kind redemption" } : undefined,
    simulation: r.simulation, approvalNeeded: r.approvalNeeded,
    tx: r.tx ? { to: r.tx.to, data: r.tx.data, value: r.tx.value, gas: r.tx.gas, chainId: r.tx.chainId } : null,
    quote_hash: r.quoteHash,
  };
}

export function explainReceipts(r: any) {
  const out: string[] = [];
  const receipts = r.receipts as Array<Record<string, string | number>>;
  for (const x of receipts) {
    const q = r.quotes?.[x.quote_hash as string];
    const shares = formatWad(BigInt(String(x.shares_out)), 6);
    const ratio = formatWad(BigInt(String(x.ratio)), 6);
    // amount_in is USDG (6 decimals) when USDG was spent, and the token itself (18) on a sell
    const spent = String(x.token_in).toLowerCase() !== String(x.representation).toLowerCase() ? formatUsdg(BigInt(String(x.amount_in)), 4) + " USDG" : formatWad(BigInt(String(x.amount_in)), 6) + " tokens";
    let line = `${String(x.action).toUpperCase()} ${x.underlying}: ${spent} -> ${formatWad(BigInt(String(x.tokens_out)), 6)} tokens of ${x.representation} = ${shares} shares (ratio ${ratio}), quote ${x.quote_hash}`;
    if (q?.chosen?.why) line += `\n  why: ${q.chosen.why}`;
    if (q?.candidates) line += `\n  candidates: ` + q.candidates.map((c: any) => `${c.symbol}${c.eligible ? "" : " (excluded: " + c.reasons.join("; ") + ")"}${c.costPerShareUsd && c.costPerShareUsd !== "0" ? " " + c.costPerShareUsd + "/sh " + c.premiumBps + "bps" : ""}`).join(" | ");
    if (q?.breakdown) line += `\n  basket fills: ` + q.breakdown.map((b: any) => `${b.ticker}: ${b.fills.map((f: any) => `${f.symbol} ${formatWad(BigInt(f.shares), 6)}sh @${f.costPerShareUsd}`).join(", ")}`).join(" | ");
    if (q?.policy) line += `\n  policy: ${JSON.stringify(q.policy)}`;
    const inv = x.action === "buy" ? "ShareRouter enforced minShares (shares, not tokens) and buy-eligibility (the token's multiplier within its step bound of the last checkpoint)" : x.action === "mint" ? "BasketVault enforced the backing invariant heldShares >= supply*sharesPerUnit for every constituent and issuer caps" : x.action === "migrate" ? "BasketVault enforced a strict share increase for the constituent with no other constituent or USDG decreasing" : x.action === "redeem" ? "BasketVault sold only the redeemer's pro-rata slice and delivered any unsold remainder in kind" : "";
    if (inv) line += `\n  enforced onchain: ${inv}`;
    out.push(line);
  }
  return { tx_hash: receipts[0]?.tx_hash, count: receipts.length, explanation: out.join("\n\n") };
}
