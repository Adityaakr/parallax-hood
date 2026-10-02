/**
 * Drives the MCP server over stdio with the official client against the local mocks chain (`pnpm mocks:up`).
 * Owner = the local dev key (holds mock USDG), agent = a second dev key that only ever acts through AgentMandate.
 * Skipped when that chain is not up or has no deployment on this machine.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { serve } from "@hono/node-server";
import { createWalletClient, createPublicClient, http, type Address, type Hex, encodeFunctionData, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { localMocks, Erc20Abi, AgentMandateAbi, parseWad, parseUsdg, tickerToId, parseDeployment } from "@parallax-hood/sdk";
import { createApp, createServices, loadConfig } from "@parallax-hood/resolver";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const RPC = "http://127.0.0.1:8648";
const DEPLOYMENT = resolve(here, "../../../contracts/deployments/1337.json");
const OWNER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d96d4fd05f9" as const;
const AGENT_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const owner = privateKeyToAccount(OWNER_PK);
const agent = privateKeyToAccount(AGENT_PK);

async function chainUp() {
  try {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
    return ((await r.json()) as { result?: string }).result === "0x539";
  } catch {
    return false;
  }
}
const up = existsSync(DEPLOYMENT) && (await chainUp());
const d = up ? describe : describe.skip;

d("MCP server end to end (mocks chain)", () => {
  let client: Client;
  let stop: () => void;
  let mandateId: bigint;
  const dep = parseDeployment(JSON.parse(readFileSync(DEPLOYMENT, "utf8")));
  const pub = createPublicClient({ chain: localMocks, transport: http(RPC) });
  const ownerWallet = createWalletClient({ account: owner, chain: localMocks, transport: http(RPC) });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args });
    const t = (r.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    return { isError: Boolean(r.isError), text: t, json: () => JSON.parse(t) };
  };

  // The suite creates a mandate and trades on the shared mocks chain. Snapshot before and revert after, so it
  // leaves the chain as it found it for whatever runs next.
  let snapshot: string | null = null;

  beforeAll(async () => {
    snapshot = (await pub.request({ method: "evm_snapshot" as never, params: [] as never })) as string;
    // in-process resolver on a free port
    const s = createServices(loadConfig({ ...process.env, CHAIN_ID: "1337", MOCKS_RPC_URL: RPC, LOG_LEVEL: "error", MARKET_HISTORY: "" }), ":memory:");
    const srv = serve({ fetch: createApp(s).fetch, port: 0 });
    const port = (srv.address() as { port: number }).port;
    stop = () => srv.close();

    // owner creates a mandate for the agent: 100 USDG per tx, 150 per day, NVDA + basket allowed
    const basket = dep.baskets.pxMAG7!;
    let h = await ownerWallet.writeContract({ address: dep.usdg, abi: Erc20Abi, functionName: "approve", args: [dep.mandate, parseUsdg("1000")] });
    await pub.waitForTransactionReceipt({ hash: h });
    h = await ownerWallet.writeContract({
      address: dep.mandate, abi: AgentMandateAbi, functionName: "createMandate",
      args: [agent.address, parseUsdg("100"), parseUsdg("150"), BigInt(Math.floor(Date.now() / 1000) + 86400), 300, [tickerToId("NVDA")], [basket]],
    });
    await pub.waitForTransactionReceipt({ hash: h });
    mandateId = (await pub.readContract({ address: dep.mandate, abi: AgentMandateAbi, functionName: "nextId" })) - 1n;
    // fund agent with gas
    await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: [agent.address, "0x8AC7230489E80000"] }) });

    const transport = new StdioClientTransport({
      command: "npx",
      args: ["tsx", resolve(here, "../src/index.ts")],
      env: { ...process.env, CHAIN_ID: "1337", MOCKS_RPC_URL: RPC, RESOLVER_URL: `http://127.0.0.1:${port}`, AGENT_PRIVATE_KEY: AGENT_PK, NODE_NO_WARNINGS: "1" },
      stderr: "pipe",
    });
    client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    stop?.();
    if (snapshot) await pub.request({ method: "evm_revert" as never, params: [snapshot] as never });
  });

  it("lists the read tools and exactly one write tool", async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual(["build_create_mandate", "execute_with_mandate", "explain_receipt", "get_basket", "get_mandate", "get_network", "get_receipts", "list_baskets", "quote_basket_mint", "quote_basket_redeem", "resolve_stock", "search_stocks"]);
  });

  it("get_network says which chain this is and what on it is mocked", async () => {
    const n = (await call("get_network")).json();
    expect(n).toMatchObject({ name: "Local mocks", kind: "local", chainId: 1337, usdgDecimals: 6 });
    expect(n.mocked).toEqual(["stock tokens", "USDG", "swap venue", "reference prices"]);
    expect(n.eligibility).toMatch(/U\.S\. persons/);
    expect(n.agent.toLowerCase()).toBe(agent.address.toLowerCase());
  });

  it("search_stocks and resolve_stock return ranked candidates with reasons and a quote_hash", async () => {
    const s = (await call("search_stocks", { query: "NVDA" })).json();
    expect(s.stocks[0].ticker).toBe("NVDA");
    const r = (await call("resolve_stock", { ticker: "NVDA", usd_amount: "50", policy: { maxPremiumBps: 100 }, wallet: owner.address })).json();
    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0].platform).toBe("robinhood");
    // 50 USDG at about 231 dollars a share: a fifth of a share, in whole-USDG and whole-share strings
    expect(r.chosen.usdgIn).toBe("50");
    expect(Number(r.chosen.sharesOut)).toBeGreaterThan(0.2);
    expect(Number(r.chosen.sharesOut)).toBeLessThan(0.23);
    expect(r.fee.totalUsdgIn).toBe("50.25");
    expect(r.quote_hash).toMatch(/^0x/);
    expect(r.chosen.why).toContain("USD/share");
  });

  it("get_mandate reflects onchain limits", async () => {
    const m = (await call("get_mandate", { id: mandateId.toString() })).json();
    expect(m.perTxCapUsdg).toBe("100");
    expect(m.dailyCapUsdg).toBe("150");
    expect(m.isConfiguredAgent).toBe(true);
    expect(m.owner.toLowerCase()).toBe(owner.address.toLowerCase());
  });

  it("build_create_mandate returns owner-signed unsigned txs", async () => {
    const r = (await call("build_create_mandate", { owner: owner.address, per_tx_cap_usdg: "25", daily_cap_usdg: "50", expiry_iso: new Date(Date.now() + 3600_000).toISOString(), allowed_tickers: ["NVDA"] })).json();
    expect(r.createMandateTx.to.toLowerCase()).toBe(dep.mandate.toLowerCase());
    expect(r.approveUsdgTx.to.toLowerCase()).toBe(dep.usdg.toLowerCase());
    expect(r.summary).toContain("outputs always go to");
  });

  it("execute_with_mandate: buys $50 NVDA for the owner, refuses over-cap and off-allowlist", async () => {
    const dry = await call("execute_with_mandate", { mandate_id: mandateId.toString(), action: "buy_shares", params: { ticker: "NVDA", usd_amount: "50", policy: { maxPremiumBps: 60 } }, dry_run: true });
    expect(dry.isError).toBe(false);
    expect(dry.json().simulation.ok).toBe(true);

    expect(dry.json().network.kind).toBe("local");

    const nvda = dep.mocks!.NVDA!;
    const ownerBefore = await pub.readContract({ address: nvda, abi: Erc20Abi, functionName: "balanceOf", args: [owner.address] });
    const ownerUsdgBefore = await pub.readContract({ address: dep.usdg, abi: Erc20Abi, functionName: "balanceOf", args: [owner.address] });
    const ex = await call("execute_with_mandate", { mandate_id: mandateId.toString(), action: "buy_shares", params: { ticker: "NVDA", usd_amount: "50", policy: { maxPremiumBps: 60 } } });
    expect(ex.isError).toBe(false);
    const j = ex.json();
    expect(j.status).toBe("success");
    const after = await pub.readContract({ address: nvda, abi: Erc20Abi, functionName: "balanceOf", args: [owner.address] });
    expect(after > ownerBefore).toBe(true);
    // the owner paid 50 USDG plus the 50 bps fee, in 6-decimal units
    const ownerUsdgAfter = await pub.readContract({ address: dep.usdg, abi: Erc20Abi, functionName: "balanceOf", args: [owner.address] });
    expect(ownerUsdgBefore - ownerUsdgAfter).toBe(parseUsdg("50.25"));
    for (const t of [nvda, dep.usdg]) {
      expect(await pub.readContract({ address: t, abi: Erc20Abi, functionName: "balanceOf", args: [agent.address] })).toBe(0n);
    }

    const over = await call("execute_with_mandate", { mandate_id: mandateId.toString(), action: "buy_shares", params: { ticker: "NVDA", usd_amount: "120" } });
    expect(over.isError).toBe(true);
    expect(over.text).toMatch(/exceeds per-tx cap/);
    const daily = await call("execute_with_mandate", { mandate_id: mandateId.toString(), action: "buy_shares", params: { ticker: "NVDA", usd_amount: "100.5" } });
    expect(daily.text).toMatch(/exceeds (per-tx|remaining daily) cap/);
    const off = await call("execute_with_mandate", { mandate_id: mandateId.toString(), action: "buy_shares", params: { ticker: "AAPL", usd_amount: "10" } });
    expect(off.isError).toBe(true);
    expect(off.text).toMatch(/not on this mandate's allowlist/);

    const ex2 = (await call("explain_receipt", { tx_hash: j.txHash })).json();
    expect(ex2.count).toBeGreaterThanOrEqual(1);
    expect(ex2.explanation).toMatch(/BUY NVDA/);
    expect(ex2.explanation).toMatch(/why:/);
  });

  it("execute_with_mandate: mints a basket for the owner within caps", async () => {
    const b = (await call("list_baskets")).json().baskets.find((x: any) => x.symbol === "pxMAG7");
    const q = (await call("quote_basket_mint", { basket: b.symbol, units: "0.5", wallet: owner.address })).json();
    expect(q.status).toBe("ok");
    const ex = await call("execute_with_mandate", { mandate_id: mandateId.toString(), action: "mint_basket", params: { basket: b.symbol, units: "0.5" } });
    expect(ex.isError).toBe(false);
    expect(ex.json().status).toBe("success");
    const units = await pub.readContract({ address: b.address as Address, abi: Erc20Abi, functionName: "balanceOf", args: [owner.address] });
    expect(units >= parseWad("0.5")).toBe(true);
    const m = (await call("get_mandate", { id: mandateId.toString() })).json();
    // 50.25 for the stock and about 50 for half a unit, out of a 150 daily cap
    expect(Number(m.spentInWindowUsdg)).toBeGreaterThan(99);
    expect(Number(m.spentInWindowUsdg)).toBeLessThan(102);
    const rd = (await call("quote_basket_redeem", { basket: b.symbol, units: "0.1", in_kind: true, wallet: owner.address })).json();
    expect(rd.kind).toBe("redeemInKind");
  });

  it("owner revocation is final for the agent", async () => {
    const h = await ownerWallet.writeContract({ address: dep.mandate, abi: AgentMandateAbi, functionName: "revoke", args: [mandateId] });
    await pub.waitForTransactionReceipt({ hash: h });
    const r = await call("execute_with_mandate", { mandate_id: mandateId.toString(), action: "buy_shares", params: { ticker: "NVDA", usd_amount: "1" } });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/revoked/);
  });
});
