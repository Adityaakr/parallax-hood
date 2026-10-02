import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createPublicClient, createWalletClient, http, type Address, type Hex, encodeFunctionData, isAddress, getAddress, decodeErrorResult, type PublicClient, type WalletClient, type Account } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { AgenticWallet } from "./agenticWallet.js";
import { AgentMandateAbi, ShareRouterAbi, BasketVaultAbi, Erc20Abi, CHAINS, chainIdToNetwork, tickerToId, idToTicker, formatWad, parseWad, deserializeLegs, type Leg } from "@parallax-hood/sdk";

export type McpConfig = {
  resolverUrl: string;
  chainId: number;
  rpcUrl: string;
  mandateAddress: Address;
  routerAddress: Address;
  usdt: Address;
  agentPrivateKey?: Hex;
  /** Soft policy defaults layered on top of onchain mandates. */
  softPolicy: { maxAttestationAgeHours: number; maxPremiumBps: number; maxClosedMarketPremiumBps: number; maxSlippageBps: number; preferPlatforms: string[]; excludePlatforms: string[] };
};

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2) }] });
const err = (msg: string) => ({ isError: true, content: [{ type: "text" as const, text: msg }] });

const PolicyIn = z
  .object({
    maxAttestationAgeHours: z.number().positive().optional().describe("Hard-exclude representations whose platform attestation is older than this (hours)."),
    maxPremiumBps: z.number().int().optional().describe("Max effective premium vs reference price while the market is open, in bps (includes gas)."),
    maxClosedMarketPremiumBps: z.number().int().optional().describe("Max premium while the US market is closed, in bps."),
    maxSlippageBps: z.number().int().min(0).max(10000).optional().describe("Max slippage vs marginal price, bps. Also sets minShares = sharesOut * (1 - this)."),
    maxIssuerBps: z.number().int().min(0).max(10000).optional().describe("Max share of your holdings of this underlying with a single issuer after the trade."),
    preferPlatforms: z.array(z.enum(["ondo", "bstock", "xstock"])).optional(),
    excludePlatforms: z.array(z.enum(["ondo", "bstock", "xstock"])).optional(),
    allowClosedMarket: z.boolean().optional().describe("Allow execution while the market is closed (subject to maxClosedMarketPremiumBps)."),
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

  /**
   * Plan an action THROUGH an AgentMandate for whichever key will sign it (this server's agent key, or a
   * Binance Agentic Wallet paired as the agent). Refuses everything the contract would refuse before any
   * signer is involved: wrong agent, inactive, expired, caps, allowlists.
   */
  type MandateParams = { ticker?: string; usd_amount?: string; basket?: string; units?: string; usd?: string; policy?: z.infer<typeof PolicyIn> };
  type Planned = { refused: string } | { data: Hex; plan: unknown; quoteHash: Hex; m: { owner: Address; agent: Address; perTxCapUsdt: bigint; dailyCapUsdt: bigint } };
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
      const amount = parseWad(p.params.usd_amount);
      const uid = tickerToId(p.params.ticker.toUpperCase());
      const allowed = await pub.readContract({ address: cfg.mandateAddress, abi: AgentMandateAbi, functionName: "allowedUnderlying", args: [id, uid] });
      if (!allowed) refusals.push(`${p.params.ticker.toUpperCase()} is not on this mandate's allowlist`);
      if (amount > m.perTxCapUsdt) refusals.push(`${p.params.usd_amount} USDT exceeds per-tx cap ${formatWad(m.perTxCapUsdt)}`);
      if (amount > remaining) refusals.push(`${p.params.usd_amount} USDT exceeds remaining daily cap ${formatWad(remaining)}`);
      if (refusals.length) return { refused: `refused by mandate policy: ${refusals.join("; ")}` };
      const r = await api("/resolve", { method: "POST", body: JSON.stringify({ ticker: p.params.ticker, side: "buy", usdAmount: p.params.usd_amount, policy: policy(p.params.policy), wallet: m.owner, recipient: m.owner }) });
      if (r.status !== "ok" || !r.chosen) return { refused: `no route: ${r.status}. ${r.candidates.map((c: any) => `${c.symbol}: ${c.reasons.join("; ") || "ok"}`).join(" | ")}` };
      // the router pulls the notional plus the protocol fee; the mandate authorizes that total
      const total = BigInt(r.fee?.totalUsdtIn ?? amount);
      if (total > m.perTxCapUsdt) return { refused: `${formatWad(total, 2)} USDT incl. fee exceeds per-tx cap ${formatWad(m.perTxCapUsdt)}` };
      if (total > remaining) return { refused: `${formatWad(total, 2)} USDT incl. fee exceeds remaining daily cap ${formatWad(remaining)}` };
      quoteHash = r.quoteHash;
      data = encodeFunctionData({ abi: AgentMandateAbi, functionName: "agentBuyShares", args: [id, uid, total, BigInt(r.chosen.minShares), deserializeLegs(r.chosen.legs), quoteHash] });
      plan = summarizeResolve(r);
    } else {
      if (!p.params.basket || (!p.params.units && !p.params.usd)) return { refused: "mint_basket needs basket and units (or usd)" };
      const q = await api(`/baskets/${encodeURIComponent(p.params.basket)}/quote-mint`, { method: "POST", body: JSON.stringify({ units: p.params.units, budgetUsdt: p.params.usd, policy: policy(p.params.policy), wallet: m.owner, recipient: m.owner }) });
      if (q.status !== "ok") return { refused: `no route: ${q.problems.join("; ")}` };
      const basket = getAddress(q.basket);
      const allowed = await pub.readContract({ address: cfg.mandateAddress, abi: AgentMandateAbi, functionName: "allowedBasket", args: [id, basket] });
      if (!allowed) refusals.push(`basket ${q.symbol} is not on this mandate's allowlist`);
      const amount = BigInt(q.maxUsdtIn);
      if (amount > m.perTxCapUsdt) refusals.push(`maxUsdtIn ${formatWad(amount, 2)} exceeds per-tx cap ${formatWad(m.perTxCapUsdt)}`);
      if (amount > remaining) refusals.push(`maxUsdtIn ${formatWad(amount, 2)} exceeds remaining daily cap ${formatWad(remaining)}`);
      if (refusals.length) return { refused: `refused by mandate policy: ${refusals.join("; ")}` };
      quoteHash = q.quoteHash;
      data = encodeFunctionData({ abi: AgentMandateAbi, functionName: "agentMintBasket", args: [id, basket, BigInt(q.units), amount, deserializeLegs(q.legs), quoteHash] });
      plan = { basket: q.symbol, units: formatWad(BigInt(q.units), 6), expectedUsdt: formatWad(BigInt(q.expectedUsdt), 4), maxUsdtIn: formatWad(amount, 4), breakdown: q.breakdown.map((b: any) => ({ ticker: b.ticker, fills: b.fills.map((f: any) => `${f.symbol} ${formatWad(BigInt(f.shares), 6)} sh @ ${f.costPerShareUsd} (${f.premiumBps} bps)`) })) };
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
      "Parallax routes tokenized-stock purchases on BNB Chain to the best representation (Ondo, bStocks) measured in underlying shares, " +
      "and manages share-defined indices (pxMAG7, pxAI, pxNEW). Read tools return ranked candidates with reasons and a quote_hash that links the onchain receipt to its scoring record. " +
      "A paired Binance Agentic Wallet (baw) can be the execution layer on mainnet: compare_with_binance_wallet quotes the wallet's own route per issuer, agentic_wallet_preview hands Parallax calldata to Binance's simulation and risk parse, agentic_wallet_execute broadcasts after the user confirms. " +
      "The only write tool is execute_with_mandate: it signs with the configured agent key and can only act through the AgentMandate contract, " +
      "so per-tx caps, daily caps, expiry and allowlists are enforced onchain and outputs always go to the mandate owner. It simulates before sending. " +
      "Not investment advice; tokenized stock availability depends on jurisdiction and issuer terms.",
  });

  // ------------------------------------------------------------------
  // Read tools
  // ------------------------------------------------------------------

  server.registerTool("search_stocks", {
    title: "Search stocks",
    description: "List canonical underlyings (e.g. NVDA) with every tokenized representation on BSC: issuer, token address, share ratio and its source, attestation freshness, buy/sell eligibility, reference price and market status. Data sources are labeled (live vs fixture).",
    inputSchema: { query: z.string().optional().describe("Ticker or symbol substring, e.g. 'NVDA' or 'TSLA'. Empty lists everything.") },
  }, async ({ query }) => {
    const r = await api(`/stocks${query ? `?query=${encodeURIComponent(query)}` : ""}`);
    return text(r);
  });

  server.registerTool("resolve_stock", {
    title: "Resolve a stock buy or sell",
    description:
      "Score every representation of an underlying for a buy of usd_amount USDT (or a sell), apply the policy, and return ranked candidates with plain-language reasons, the chosen route (legs, split), the share-denominated minShares, an unsigned ShareRouter transaction (only if it passed simulation), and the quote_hash. Amounts are decimal strings.",
    inputSchema: {
      ticker: z.string().describe("Underlying ticker, e.g. NVDA"),
      usd_amount: z.string().describe("USDT amount as a decimal string, e.g. '50'"),
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
    description: "All Parallax indices with NAV per unit (display only), period price returns from Chainlink rounds (with coverageBps: the share of NAV that has a feed), minimum investment in USD, allocation by value, and whether the index is deployed on this network.",
    inputSchema: {},
  }, async () => text(await api("/baskets")));

  server.registerTool("get_basket", {
    title: "Get basket",
    description: "Basket detail: composition per constituent and representation, backing ratio (held/required, must be >= 1.00), issuer caps vs actual, and current share-accretive migration opportunities.",
    inputSchema: { basket: z.string().describe("Basket symbol (pxMAG7) or address") },
  }, async ({ basket }) => text(await api(`/baskets/${encodeURIComponent(basket)}`)));

  server.registerTool("quote_basket_mint", {
    title: "Quote basket mint",
    description: "Quote minting `units` (or usd_amount worth) of a basket: per-constituent fills across issuers under caps, expected USDT, maxUsdtIn, legs, simulation result, unsigned BasketVault.mint transaction and quote_hash.",
    inputSchema: {
      basket: z.string(),
      units: z.string().optional().describe("Basket units as a decimal string, e.g. '1'"),
      usd_amount: z.string().optional().describe("Alternative: the USDT budget to spend; units are sized so maxUsdtIn stays within it"),
      policy: PolicyIn,
      wallet: z.string().optional(),
    },
  }, async ({ basket, units, usd_amount, policy: p, wallet: w }) => {
    const r = await api(`/baskets/${encodeURIComponent(basket)}/quote-mint`, { method: "POST", body: JSON.stringify({ units, budgetUsdt: usd_amount, policy: policy(p), wallet: w }) });
    return text({ ...r, legs: undefined, tx: r.tx ? { to: r.tx.to, data_bytes: (r.tx.data.length - 2) / 2, gas: r.tx.gas } : null, legsCount: r.legs?.length });
  });

  server.registerTool("quote_basket_redeem", {
    title: "Quote basket redeem",
    description: "Quote redeeming `units` of a basket to USDT through the best exit per representation, or in kind (pro-rata tokens, always available, no oracle). Returns slices, minUsdtOut, unsigned transaction and quote_hash.",
    inputSchema: { basket: z.string(), units: z.string(), in_kind: z.boolean().default(false), policy: PolicyIn, wallet: z.string().optional() },
  }, async ({ basket, units, in_kind, policy: p, wallet: w }) => {
    const r = await api(`/baskets/${encodeURIComponent(basket)}/quote-redeem`, { method: "POST", body: JSON.stringify({ units, inKind: in_kind, policy: policy(p), wallet: w }) });
    return text({ ...r, legs: undefined, tx: r.tx ? { to: r.tx.to, data_bytes: (r.tx.data.length - 2) / 2 } : null });
  });

  server.registerTool("get_mandate", {
    title: "Get mandate",
    description: "Read an AgentMandate: owner, agent, per-tx and daily caps (USDT), max slippage vs reference price (bps), spent in the current 24h window, remaining today, expiry, active flag.",
    inputSchema: { id: z.string().describe("Mandate id (uint)") },
  }, async ({ id }) => {
    const m = await pub.readContract({ address: cfg.mandateAddress, abi: AgentMandateAbi, functionName: "getMandate", args: [BigInt(id)] });
    const remaining = await pub.readContract({ address: cfg.mandateAddress, abi: AgentMandateAbi, functionName: "remainingDaily", args: [BigInt(id)] });
    return text({
      id, owner: m.owner, agent: m.agent, active: m.active, expiry: Number(m.expiry), expiryIso: new Date(Number(m.expiry) * 1000).toISOString(),
      perTxCapUsdt: formatWad(m.perTxCapUsdt), dailyCapUsdt: formatWad(m.dailyCapUsdt), maxSlippageBps: m.maxSlippageBps, spentInWindowUsdt: formatWad(m.spentInWindow), windowStart: Number(m.windowStart), remainingDailyUsdt: formatWad(remaining),
      isConfiguredAgent: agent ? m.agent.toLowerCase() === agent.address.toLowerCase() : false, mandateContract: cfg.mandateAddress,
    });
  });

  server.registerTool("build_create_mandate", {
    title: "Build create-mandate transaction",
    description: "Build the unsigned transaction the OWNER signs to create an AgentMandate for an agent address with hard onchain limits. Also returns the USDT approval the owner must grant to the mandate contract.",
    inputSchema: {
      owner: z.string().describe("Owner wallet (signs this tx; receives all outputs)"),
      agent: z.string().optional().describe("Agent address. Defaults to this server's configured agent key."),
      per_tx_cap_usdt: z.string().describe("Per-transaction cap in USDT, decimal string"),
      daily_cap_usdt: z.string().describe("Daily (24h window) cap in USDT"),
      expiry_iso: z.string().describe("ISO date/time when the mandate expires"),
      max_slippage_bps: z.number().int().min(1).max(2000).default(300).describe("Worst execution the agent may accept, bps below the registry's reference price (Chainlink / keeper), fees included. Enforced onchain per trade; 1-2000."),
      allowed_tickers: z.array(z.string()).default([]).describe("Underlyings the agent may buy, e.g. ['NVDA','AAPL']"),
      allowed_baskets: z.array(z.string()).default([]).describe("Basket addresses the agent may mint"),
    },
  }, async ({ owner, agent: a, per_tx_cap_usdt, daily_cap_usdt, expiry_iso, max_slippage_bps, allowed_tickers, allowed_baskets }) => {
    if (!isAddress(owner)) return err("owner must be an address");
    const agentAddr = a ?? agent?.address;
    if (!agentAddr || !isAddress(agentAddr)) return err("agent address required (no agent key configured)");
    const expiry = Math.floor(new Date(expiry_iso).getTime() / 1000);
    if (!Number.isFinite(expiry) || expiry <= Date.now() / 1000) return err("expiry must be a future ISO date");
    const baskets = allowed_baskets.map((b) => (isAddress(b) ? getAddress(b) : null));
    if (baskets.some((b) => b === null)) return err("allowed_baskets must be addresses");
    const data = encodeFunctionData({
      abi: AgentMandateAbi, functionName: "createMandate",
      args: [getAddress(agentAddr), parseWad(per_tx_cap_usdt), parseWad(daily_cap_usdt), BigInt(expiry), max_slippage_bps, allowed_tickers.map((t) => tickerToId(t.toUpperCase())), baskets as Address[]],
    });
    const approve = encodeFunctionData({ abi: Erc20Abi, functionName: "approve", args: [cfg.mandateAddress, parseWad(daily_cap_usdt)] });
    return text({
      chainId: cfg.chainId,
      createMandateTx: { from: getAddress(owner), to: cfg.mandateAddress, data, value: "0" },
      approveUsdtTx: { from: getAddress(owner), to: cfg.usdt, data: approve, value: "0", note: "approve at least the daily cap; the mandate pulls USDT from the owner per trade" },
      summary: `agent ${agentAddr} may spend up to ${per_tx_cap_usdt} USDT per tx and ${daily_cap_usdt} USDT per 24h on ${allowed_tickers.join(", ") || "no stocks"} / ${baskets.length} basket(s) until ${expiry_iso}, never worse than ${max_slippage_bps} bps below the reference price; outputs always go to ${owner}; owner can revoke instantly`,
    });
  });

  server.registerTool("get_receipts", {
    title: "Get receipts",
    description: "Indexed RouteReceipt events (buy/sell/mint/redeem/migrate) with shares, ratio and attestation at execution time, filterable by actor, underlying, basket or quote_hash.",
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
    description: "Fetch the RouteReceipt(s) of a transaction and their scoring records (by quote_hash) and explain in plain language why that route was chosen: candidates, premiums, slippage, attestation ages, policy and the invariant the contract enforced.",
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
        usd_amount: z.string().optional().describe("buy_shares: USDT to spend"),
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
    if (dry_run) return text({ dryRun: true, simulation: { ok: true, gas: gas.toString() }, quoteHash, plan, to: cfg.mandateAddress, owner: m.owner, agent: agent.address });
    const hash = await wallet.sendTransaction({ account: agent, chain, to: cfg.mandateAddress, data, gas: (gas * 12n) / 10n });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    let receipts: unknown = null;
    try {
      receipts = (await api(`/receipts/${hash}`)).receipts;
    } catch {
      /* indexer may lag */
    }
    return text({ txHash: hash, status: rcpt.status, gasUsed: rcpt.gasUsed.toString(), quoteHash, owner: m.owner, agent: agent.address, plan, receipts });
  });


  // ------------------------------------------------------------------
  // Binance Agentic Wallet: the user's (or the agent's) Binance-paired wallet as the execution layer
  // ------------------------------------------------------------------
  const aw = new AgenticWallet();
  const awOnlyMainnet = cfg.chainId === 56 ? null : `the Binance Agentic Wallet supports BSC mainnet only (no chain ${cfg.chainId}); this server runs on ${network}. On testnet the Agent Studio wallet executes instead.`;

  server.registerTool("agentic_wallet_status", {
    title: "Binance Agentic Wallet status",
    description: "Whether a Binance Agentic Wallet is paired on this machine (baw CLI), its BSC address, Developer Mode (needed for contract calls), daily limits and session expiry. No transaction.",
    inputSchema: {},
  }, async () => {
    const status = await aw.status();
    if (status !== "CONNECTED") return text({ status, hint: "run `baw auth signin --json`, scan the QR in the Binance app, then `baw auth verify --qrCodeId <id> --json`" });
    const [address, settings] = await Promise.all([aw.address("56"), aw.settings()]);
    return text({ status, address, devMode: settings?.devMode ?? null, dailyLimitUsd: settings?.dailyLimit ?? null, quotaLeftUsd: settings?.quotaLeft ?? null, sessionExpires: settings?.sessionExpireTime ?? null, chain: "BSC mainnet (56) only", mandateContract: cfg.mandateAddress });
  });

  server.registerTool("compare_with_binance_wallet", {
    title: "Compare Parallax's route with the Binance Wallet's route",
    description:
      "For one stock and dollar amount, quote every issuer token through the Binance Agentic Wallet's own swap route (market-order quote, nothing traded) and convert each to cost per underlying share with the registry ratio, next to Parallax's ranked candidates. Shows whether both execution layers agree on the cheapest issuer. Mainnet only.",
    inputSchema: { ticker: z.string(), usd_amount: z.string().describe("USDT to spend, decimal string") },
  }, async ({ ticker, usd_amount }) => {
    if (awOnlyMainnet) return err(awOnlyMainnet);
    const r = await api("/resolve", { method: "POST", body: JSON.stringify({ ticker: ticker.toUpperCase(), side: "buy", usdAmount: usd_amount, policy: policy() }) });
    const usd = Number(usd_amount);
    const viaWallet = [];
    for (const c of r.candidates as { symbol: string; platform: string; token: Address; ratio: string; costPerShareUsd: string; premiumBps: number; eligible: boolean }[]) {
      const q = await aw.quote({ fromToken: cfg.usdt, toToken: c.token, qty: usd_amount });
      if (!q.success) { viaWallet.push({ symbol: c.symbol, issuer: c.platform, error: q.error.message }); continue; }
      const tokens = Number(q.data.toCoinAmount);
      const shares = tokens / (Number(c.ratio) / 1e18);
      viaWallet.push({ symbol: c.symbol, issuer: c.platform, tokensOut: q.data.toCoinAmount, sharesOut: shares.toFixed(6), costPerShareUsd: (usd / shares).toFixed(4), walletSlippage: q.data.slippage, parallaxCostPerShareUsd: c.costPerShareUsd, parallaxPremiumBps: c.premiumBps, parallaxEligible: c.eligible });
    }
    const cheapestWallet = [...viaWallet].filter((x) => "costPerShareUsd" in x).sort((a: any, b: any) => Number(a.costPerShareUsd) - Number(b.costPerShareUsd))[0] as { symbol: string } | undefined;
    const cheapestParallax = (r.candidates as any[]).filter((c) => c.eligible).sort((a, b) => Number(a.costPerShareUsd) - Number(b.costPerShareUsd))[0];
    return text({ ticker: r.underlying, usd: usd_amount, referencePrice: r.referencePrice, referenceSource: r.referenceSource, binanceWallet: viaWallet, parallaxChosen: r.chosen ? { why: r.chosen.why, sharesOut: formatWad(BigInt(r.chosen.sharesOut), 6) } : null, agree: cheapestWallet && cheapestParallax ? cheapestWallet.symbol === cheapestParallax.symbol : null, note: "wallet quotes route through Binance's aggregator with its own fees; Parallax prices pools and the aggregator in shares and executes onchain with a share-denominated minimum" });
  });

  server.registerTool("agentic_wallet_preview", {
    title: "Preview a Parallax action in the Binance Agentic Wallet",
    description:
      "Step 1 of 2. Build the calldata for a Parallax action and hand it to the Binance Agentic Wallet's contract-call preview: Binance simulates it, parses it and scores its risk, and returns a request id. Actions: approve_usdt (spender + amount), mint_index (the wallet mints an index for itself), buy_shares (the wallet buys a stock at best execution for itself), or the same via a mandate (via_mandate_id: the wallet acts as that mandate's AGENT and outputs go to the mandate owner). Nothing is sent; call agentic_wallet_execute with the request id after the user confirms. Mainnet only.",
    inputSchema: {
      action: z.enum(["approve_usdt", "mint_index", "buy_shares"]),
      params: z.object({
        ticker: z.string().optional(), usd_amount: z.string().optional().describe("USDT to spend (buy_shares / mint_index / approve_usdt amount)"),
        basket: z.string().optional().describe("index symbol or address"), units: z.string().optional(), spender: z.string().optional().describe("approve_usdt: spender (defaults to the mandate contract)"),
        policy: PolicyIn,
      }),
      via_mandate_id: z.string().optional().describe("Execute through this AgentMandate with the wallet as its agent"),
    },
  }, async ({ action, params, via_mandate_id }) => {
    if (awOnlyMainnet) return err(awOnlyMainnet);
    if ((await aw.status()) !== "CONNECTED") return err("no Binance Agentic Wallet is paired (baw auth signin)");
    const from = await aw.address("56");
    if (!from) return err("the paired wallet has no BSC address");
    const settings = await aw.settings();
    if (!settings?.devMode.enabled) return err("Developer Mode is off in the Binance app; enable it (Wallet → Settings → Developer Mode) to preview contract calls");
    let to: Address, data: Hex, plan: unknown, quoteHash: Hex | null = null;
    if (action === "approve_usdt") {
      const spender = params.spender ? getAddress(params.spender) : cfg.mandateAddress;
      if (!params.usd_amount) return err("approve_usdt needs usd_amount");
      to = cfg.usdt; data = encodeFunctionData({ abi: Erc20Abi, functionName: "approve", args: [spender, parseWad(params.usd_amount)] });
      plan = { approve: `${params.usd_amount} USDT to ${spender}` };
    } else if (via_mandate_id) {
      const planned = await planMandate({ mandateId: via_mandate_id, action: action === "mint_index" ? "mint_basket" : "buy_shares", params: { ...params, usd: params.usd_amount }, signer: from });
      if ("refused" in planned) return err(planned.refused);
      to = cfg.mandateAddress; data = planned.data; plan = planned.plan; quoteHash = planned.quoteHash;
    } else if (action === "mint_index") {
      if (!params.basket || (!params.units && !params.usd_amount)) return err("mint_index needs basket and units or usd_amount");
      const q = await api(`/baskets/${encodeURIComponent(params.basket)}/quote-mint`, { method: "POST", body: JSON.stringify({ units: params.units, budgetUsdt: params.usd_amount, policy: policy(params.policy), wallet: from, recipient: from }) });
      if (q.status !== "ok" || !q.tx) return err(`no route: ${(q.problems ?? []).join("; ") || q.status}`);
      to = q.tx.to; data = q.tx.data; quoteHash = q.quoteHash;
      plan = { basket: q.symbol, units: formatWad(BigInt(q.units), 6), expectedUsdt: formatWad(BigInt(q.expectedUsdt), 4), maxUsdtIn: formatWad(BigInt(q.maxUsdtIn), 4), approvalNeeded: q.simulation?.approvalNeeded ?? null };
    } else {
      if (!params.ticker || !params.usd_amount) return err("buy_shares needs ticker and usd_amount");
      const r = await api("/resolve", { method: "POST", body: JSON.stringify({ ticker: params.ticker.toUpperCase(), side: "buy", usdAmount: params.usd_amount, policy: policy(params.policy), wallet: from, recipient: from }) });
      if (r.status !== "ok" || !r.tx) return err(`no route: ${r.status}. ${(r.candidates ?? []).map((c: any) => `${c.symbol}: ${c.reasons.join("; ") || "ok"}`).join(" | ")}`);
      to = r.tx.to; data = r.tx.data; quoteHash = r.quoteHash; plan = summarizeResolve(r);
    }
    const pv = await aw.preview({ from, to, data });
    if (!pv.success) return err(`Binance preview refused: ${pv.error.name} ${pv.error.message}`);
    const d = pv.data;
    return text({
      requestId: d.requestId, expiresAt: new Date(d.expiresAt).toISOString(), requireConfirmation: d.requireConfirmation, from, to, quoteHash, plan,
      parsedTx: d.parsedTx, simulation: { code: d.simulationResult.simulationCode, error: d.simulationResult.simulationErrorDetail, balanceChanges: d.simulationResult.balanceChanges, allowanceChanges: d.simulationResult.allowanceChanges, authorityChanges: d.simulationResult.authorityChanges },
      risks: d.risks.riskDetails, riskyAddresses: d.risks.addresses,
      next: "show the user the parsed transaction and risks; on an explicit yes call agentic_wallet_execute with requestId",
    });
  });

  server.registerTool("agentic_wallet_execute", {
    title: "Execute a previewed action with the Binance Agentic Wallet",
    description: "Step 2 of 2: broadcast a contract call previewed by agentic_wallet_preview, only after the user confirmed. Returns the tx hash (BROADCASTED) or PENDING_CONFIRMATION when Binance requires approval in the app. Then fetches the Parallax receipts for the transaction.",
    inputSchema: { request_id: z.string() },
  }, async ({ request_id }) => {
    if (awOnlyMainnet) return err(awOnlyMainnet);
    const ex = await aw.execute(request_id);
    if (!ex.success) return err(`Binance execute refused: ${ex.error.name} ${ex.error.message}`);
    let receipts: unknown = null;
    if (ex.data.txHash) {
      try { await pub.waitForTransactionReceipt({ hash: ex.data.txHash }); receipts = (await api(`/receipts/${ex.data.txHash}`)).receipts; } catch { /* indexer may lag or tx pending */ }
    }
    return text({ ...ex.data, receipts });
  });

  return server;
}

// ----------------------------------------------------------------------
// Plain-language helpers
// ----------------------------------------------------------------------

export function summarizeResolve(r: any) {
  const cands = (r.candidates ?? []).map((c: any) => ({
    symbol: c.symbol, platform: c.platform, venue: c.venue, eligible: c.eligible,
    costPerShareUsd: c.costPerShareUsd, premiumBps: c.premiumBps, pricePremiumBps: c.pricePremiumBps, slippageBps: c.slippageBps,
    sharesOut: c.sharesOut && c.sharesOut !== "0" ? formatWad(BigInt(c.sharesOut), 6) : "0",
    ratio: c.ratio ? formatWad(BigInt(c.ratio), 6) : undefined, ratioSource: c.ratioSource,
    attestationAgeHours: c.attestationAgeHours === null ? "unknown" : Number(c.attestationAgeHours).toFixed(1), reasons: c.reasons,
  }));
  return {
    underlying: r.underlying, side: r.side, usdAmount: r.usdAmount, status: r.status, dataSource: r.dataSource,
    referencePrice: r.referencePrice, referenceSource: r.referenceSource, marketOpen: r.marketOpen, marketSource: r.marketSource,
    nextOpenTime: r.nextOpenTime ? new Date(r.nextOpenTime).toISOString() : null, gasUsd: r.gasUsd,
    candidates: cands,
    chosen: r.chosen ? { why: r.chosen.why, split: r.chosen.split, sharesOut: formatWad(BigInt(r.chosen.sharesOut), 6), minShares: formatWad(BigInt(r.chosen.minShares), 6), usdtIn: r.chosen.usdtIn ? formatWad(BigInt(r.chosen.usdtIn), 4) : undefined, legs: r.chosen.legs?.length } : null,
    fee: r.fee ? { bps: r.fee.bps, usdt: formatWad(BigInt(r.fee.usdt), 4), totalUsdtIn: r.fee.totalUsdtIn ? formatWad(BigInt(r.fee.totalUsdtIn), 4) : undefined, netUsdtOut: r.fee.netUsdtOut ? formatWad(BigInt(r.fee.netUsdtOut), 4) : undefined, note: "protocol fee on USDT notional; none on in-kind redemption" } : undefined,
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
    const att = Number(x.attested_at) ? new Date(Number(x.attested_at) * 1000).toISOString() : "none";
    const usdt = String(x.token_in).toLowerCase() !== String(x.representation).toLowerCase() ? formatWad(BigInt(String(x.amount_in)), 4) + " USDT" : formatWad(BigInt(String(x.amount_in)), 6) + " tokens";
    let line = `${String(x.action).toUpperCase()} ${x.underlying}: ${usdt} -> ${formatWad(BigInt(String(x.tokens_out)), 6)} tokens of ${x.representation} = ${shares} shares (ratio ${ratio}, attestation ${att}), quote ${x.quote_hash}`;
    if (q?.chosen?.why) line += `\n  why: ${q.chosen.why}`;
    if (q?.candidates) line += `\n  candidates: ` + q.candidates.map((c: any) => `${c.symbol}${c.eligible ? "" : " (excluded: " + c.reasons.join("; ") + ")"}${c.costPerShareUsd && c.costPerShareUsd !== "0" ? " " + c.costPerShareUsd + "/sh " + c.premiumBps + "bps" : ""}`).join(" | ");
    if (q?.breakdown) line += `\n  basket fills: ` + q.breakdown.map((b: any) => `${b.ticker}: ${b.fills.map((f: any) => `${f.symbol} ${formatWad(BigInt(f.shares), 6)}sh @${f.costPerShareUsd}`).join(", ")}`).join(" | ");
    if (q?.policy) line += `\n  policy: ${JSON.stringify(q.policy)}`;
    const inv = x.action === "buy" ? "ShareRouter enforced minShares (shares, not tokens) and buy-eligibility (fresh ratio + attestation)" : x.action === "mint" ? "BasketVault enforced the backing invariant heldShares >= supply*sharesPerUnit for every constituent and issuer caps" : x.action === "migrate" ? "BasketVault enforced a strict share increase for the constituent with no other constituent or USDT decreasing" : x.action === "redeem" ? "BasketVault sold only the redeemer's pro-rata slice and delivered any unsold remainder in kind" : "";
    if (inv) line += `\n  enforced onchain: ${inv}`;
    out.push(line);
  }
  return { tx_hash: receipts[0]?.tx_hash, count: receipts.length, explanation: out.join("\n\n") };
}
