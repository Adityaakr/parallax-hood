/**
 * End-to-end against a local anvil with mocks (`pnpm mocks:up`, chain 1337). Skipped when the chain is not up
 * or has no deployment recorded on this machine.
 * Covers: resolve buy -> execute -> receipt indexed -> quote record; sell; basket mint / redeem / in-kind; budget
 * sizing in 6-decimal USDG. The mocks are one issuer per stock, as Robinhood Chain is, so the cross-issuer paths
 * (issuer caps, migrations) are covered by the unit tests rather than here.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createWalletClient, createPublicClient, http, type Address, type Hex, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { localMocks, Erc20Abi, WAD, USDG_UNIT } from "@parallax-hood/sdk";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfig, REPO_ROOT } from "../src/config.js";
import { createApp, createServices, type Services } from "../src/app.js";

const RPC = "http://127.0.0.1:8648";
const PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d96d4fd05f9" as const;
const account = privateKeyToAccount(PK);

async function chainUp() {
  try {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
    return ((await r.json()) as { result?: string }).result === "0x539";
  } catch {
    return false;
  }
}

const up = existsSync(resolve(REPO_ROOT, "contracts/deployments/1337.json")) && (await chainUp());
const d = up ? describe : describe.skip;

d("resolver integration (local mocks chain)", () => {
  let s: Services;
  let app: ReturnType<typeof createApp>;
  const wallet = createWalletClient({ account, chain: localMocks, transport: http(RPC) });
  const pub = createPublicClient({ chain: localMocks, transport: http(RPC) });
  const me = account.address;

  const post = async (path: string, body: unknown) => {
    const res = await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) throw new Error(`${path}: ${JSON.stringify(j)}`);
    return j as any;
  };
  const get = async (path: string) => (await app.request(path)).json() as any;
  const send = async (tx: { to: string; data: string; gas?: string }) => {
    const hash = await wallet.sendTransaction({ to: tx.to as Address, data: tx.data as Hex, gas: tx.gas ? BigInt(tx.gas) : 3_000_000n });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    expect(rcpt.status).toBe("success");
    return hash;
  };
  const approve = async (token: Address, spender: Address, amount: bigint) => {
    const hash = await wallet.writeContract({ address: token, abi: Erc20Abi, functionName: "approve", args: [spender, amount] });
    await pub.waitForTransactionReceipt({ hash });
  };

  // The suite mints, redeems and migrates on the shared mocks chain, so it leaves state behind. Snapshot before
  // and revert after, or a second `pnpm test` against the same anvil fails on assertions about a fresh vault.
  let snapshot: string | null = null;
  afterAll(async () => {
    if (snapshot) await pub.request({ method: "evm_revert" as never, params: [snapshot] as never });
  });

  beforeAll(async () => {
    snapshot = (await pub.request({ method: "evm_snapshot" as never, params: [] as never })) as string;
    // MARKET_HISTORY off: this suite must not depend on an outside HTTP source
    s = createServices(loadConfig({ ...process.env, CHAIN_ID: "1337", MOCKS_RPC_URL: RPC, LOG_LEVEL: "error", MARKET_HISTORY: "" }), ":memory:");
    app = createApp(s);
  });

  it("lists stocks with representations and labeled data sources", async () => {
    const r = await get("/stocks");
    expect(r.dataSource).toBe("fixture");
    expect(r.stocks.map((x: any) => x.ticker).sort()).toEqual(["AAPL", "AMZN", "GOOGL", "META", "MSFT", "NVDA", "TSLA"]);
    const nvda = r.stocks.find((x: any) => x.ticker === "NVDA");
    expect(nvda.representations.map((x: any) => x.symbol)).toEqual(["NVDA"]);
    expect(nvda.representations[0].platform).toBe("robinhood");
    expect(nvda.representations[0].ratioSource).toBe("ERC8056");
    expect(nvda.representations[0].buyEligible).toBe(true); // with no attestation posted: the gate is off
    expect(nvda.name).toBe("NVIDIA");
    // the mock registry's price is a posted snapshot, and is named as one rather than as a Chainlink read
    expect(nvda.referenceSource).toBe("registry reference price");
    expect(nvda.market.source).toBe("registry");
    const health = await get("/health");
    expect(health.label).toMatchObject({ kind: "local", chainId: 1337, mocked: ["stock tokens", "USDG", "swap venue", "reference prices"] });
  });

  it("resolves a buy in 6-decimal USDG, simulates, executes, indexes the receipt, serves the record", async () => {
    const r = await post("/resolve", { ticker: "NVDA", usdAmount: "500", wallet: me });
    expect(r.status).toBe("ok");
    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0].eligible).toBe(true);
    expect(r.candidates[0].venue).toBe("mock");
    expect(r.simulation.ok).toBe(true);
    expect(r.tx.to.toLowerCase()).toBe(s.chain.d.router.toLowerCase());
    expect(r.quoteHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(BigInt(r.chosen.usdgIn)).toBe(500n * USDG_UNIT);
    // 500 USDG at about $231 a share is a little over two shares, not two million and not two millionths
    const shares = Number(BigInt(r.chosen.sharesOut)) / 1e18;
    expect(shares).toBeGreaterThan(2);
    expect(shares).toBeLessThan(2.3);
    expect(Math.abs(r.candidates[0].pricePremiumBps)).toBeLessThan(30); // the mock venue's 10 bps fee, not a scale error
    // shares-denominated: minShares = 99.5 % of sharesOut
    expect(BigInt(r.chosen.minShares)).toBe((BigInt(r.chosen.sharesOut) * 9950n) / 10_000n);

    // the router pulls notional + the 50 bps protocol fee and refunds what the legs leave
    expect(r.fee.bps).toBe(50);
    expect(BigInt(r.fee.totalUsdgIn)).toBe(BigInt(r.chosen.usdgIn) + (BigInt(r.chosen.usdgIn) * 50n) / 10_000n);
    await approve(s.chain.d.usdg, s.chain.d.router, BigInt(r.fee.totalUsdgIn));
    const usdgBefore = await pub.readContract({ address: s.chain.d.usdg, abi: Erc20Abi, functionName: "balanceOf", args: [me] });
    const heldBefore = await pub.readContract({ address: s.chain.d.mocks!.NVDA!, abi: Erc20Abi, functionName: "balanceOf", args: [me] });
    const hash = await send(r.tx);
    const usdgAfter = await pub.readContract({ address: s.chain.d.usdg, abi: Erc20Abi, functionName: "balanceOf", args: [me] });
    expect(usdgBefore - usdgAfter).toBe(BigInt(r.fee.totalUsdgIn));
    const held = await pub.readContract({ address: s.chain.d.mocks!.NVDA!, abi: Erc20Abi, functionName: "balanceOf", args: [me] });
    expect(held - heldBefore).toBe(BigInt(r.candidates[0].tokensOut));
    await s.indexer.syncOnce();
    const rec = await get(`/receipts?actor=${me}`);
    const mine = rec.receipts.filter((x: any) => x.tx_hash === hash);
    expect(mine.length).toBe(1);
    expect(mine[0].action).toBe("buy");
    expect(mine[0].quote_hash).toBe(r.quoteHash);
    const q = await get(`/quotes/${r.quoteHash}`);
    expect(q.kind).toBe("buy");
    expect(q.record.chosen.why).toContain("NVDA");
    const rx = await get(`/receipts/${hash}`);
    expect(rx.quotes[r.quoteHash].underlying).toBe("NVDA");
  });

  it("sells back for USDG, net of the fee", async () => {
    const r = await post("/resolve", { ticker: "NVDA", side: "sell", tokenAmount: "1", wallet: me });
    expect(r.status).toBe("ok");
    // before the router may move the tokens the simulation fails for exactly that reason, and no tx is handed out
    expect(r.simulation.ok).toBe(false);
    expect(r.simulation.error).toMatch(/ERC20InsufficientAllowance/);
    expect(r.tx).toBeNull();
    const out = Number(BigInt(r.chosen.usdgOut)) / 1e6;
    expect(out).toBeGreaterThan(225);
    expect(out).toBeLessThan(235);
    await approve(s.chain.d.mocks!.NVDA!, s.chain.d.router, WAD);
    const again = await post("/resolve", { ticker: "NVDA", side: "sell", tokenAmount: "1", wallet: me });
    expect(again.simulation.ok).toBe(true);
    const before = await pub.readContract({ address: s.chain.d.usdg, abi: Erc20Abi, functionName: "balanceOf", args: [me] });
    await send(again.tx);
    const after = await pub.readContract({ address: s.chain.d.usdg, abi: Erc20Abi, functionName: "balanceOf", args: [me] });
    expect(after - before).toBe(BigInt(again.chosen.usdgOut));
  });

  it("applies policy exclusions with reasons", async () => {
    const r = await post("/resolve", { ticker: "NVDA", usdAmount: "100", wallet: me, policy: { excludePlatforms: ["robinhood"] } });
    expect(r.candidates[0].eligible).toBe(false);
    expect(r.candidates[0].reasons[0]).toMatch(/excluded by policy/);
    expect(r.status).toBe("no_route");
    expect(r.tx).toBeNull();
  });

  it("mints, redeems, redeems in kind, keeps backing >= 1", async () => {
    const list = await get("/baskets");
    expect(list.baskets.map((x: any) => x.symbol).sort()).toEqual(["pxAI", "pxMAG7"]);
    const b = list.baskets.find((x: any) => x.symbol === "pxMAG7");
    expect(b.constituents.length).toBe(7);
    expect(Number(b.navPerUnitUsd)).toBeGreaterThan(99);
    expect(Number(b.navPerUnitUsd)).toBeLessThan(101);
    const supply0 = BigInt(b.totalSupply);
    const mint = await post(`/baskets/${b.symbol}/quote-mint`, { units: "2", wallet: me });
    expect(mint.status).toBe("ok");
    expect(mint.problems).toEqual([]);
    expect(mint.simulation.ok).toBe(true);
    expect(mint.legs.length).toBe(7);
    // two $100 units cost about $200 in 6-decimal USDG, plus the venue and protocol fees
    const max = Number(BigInt(mint.maxUsdgIn)) / 1e6;
    expect(max).toBeGreaterThan(200);
    expect(max).toBeLessThan(204);
    await approve(s.chain.d.usdg, b.address, BigInt(mint.maxUsdgIn));
    await send(mint.tx);
    s.chain.invalidate();
    let detail = await get(`/baskets/${b.address}`);
    expect(BigInt(detail.totalSupply)).toBe(supply0 + 2n * WAD);
    expect(detail.backingOk).toBe(true);
    for (const c of detail.constituents) expect(c.backingRatio).toBeGreaterThanOrEqual(1);

    const red = await post(`/baskets/${b.address}/quote-redeem`, { units: "1", wallet: me });
    expect(red.simulation.ok).toBe(true);
    expect(Number(BigInt(red.usdgOut)) / 1e6).toBeGreaterThan(98);
    const usdgBefore = await pub.readContract({ address: s.chain.d.usdg, abi: Erc20Abi, functionName: "balanceOf", args: [me] });
    const treasury = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720"; // FEE_RECIPIENT in scripts/mocks-up.sh
    const feeBefore = await pub.readContract({ address: s.chain.d.usdg, abi: Erc20Abi, functionName: "balanceOf", args: [treasury] });
    await send(red.tx);
    // the holder receives the quoted net amount; the 50 bps fee lands with the recipient
    expect(red.fee.bps).toBe(50);
    expect(await pub.readContract({ address: s.chain.d.usdg, abi: Erc20Abi, functionName: "balanceOf", args: [treasury] })).toBe(feeBefore + BigInt(red.fee.usdg));
    const usdgAfter = await pub.readContract({ address: s.chain.d.usdg, abi: Erc20Abi, functionName: "balanceOf", args: [me] });
    expect(usdgAfter - usdgBefore).toBe(BigInt(red.usdgOut));

    const rik = await post(`/baskets/${b.address}/quote-redeem`, { units: "0.5", inKind: true, wallet: me });
    expect(rik.kind).toBe("redeemInKind");
    expect(rik.slices.every((x: any) => x.deliveredInKind)).toBe(true);
    await send(rik.tx);
    s.chain.invalidate();
    detail = await get(`/baskets/${b.address}`);
    expect(BigInt(detail.totalSupply)).toBe(supply0 + WAD / 2n);
    expect(detail.backingOk).toBe(true);
    await s.indexer.syncOnce();
    const rec = await get(`/receipts?basket=${b.address}`);
    expect(rec.receipts.some((x: any) => x.action === "mint")).toBe(true);
    expect(rec.receipts.some((x: any) => x.action === "redeem")).toBe(true);
  });

  it("offers no migration where a stock has one issuer", async () => {
    expect(await get("/migrations")).toEqual([]);
  });

  it("sizes a mint to a USDG budget and never asks for more than it", async () => {
    const budget = 500n * USDG_UNIT;
    const q = await post("/baskets/pxMAG7/quote-mint", { budgetUsdg: "500", wallet: me });
    expect(q.status).toBe("ok");
    expect(q.problems).toEqual([]);
    // the ceiling the vault may pull, fee included, is what has to fit the budget
    expect(BigInt(q.maxUsdgIn) <= budget).toBe(true);
    expect(BigInt(q.expectedUsdg) <= BigInt(q.maxUsdgIn)).toBe(true);
    // and it should use most of it: a budget that buys a tenth of what it could afford is a sizing bug
    expect(BigInt(q.maxUsdgIn) * 100n / budget).toBeGreaterThan(90n);
  });

  it("wallet view aggregates holdings in shares and counts USDG in dollars", async () => {
    const w = await get(`/wallet/${me}`);
    expect(w.holdings.some((h: any) => h.ticker === "NVDA")).toBe(true);
    expect(w.baskets.length).toBeGreaterThanOrEqual(1);
    const usdg = await pub.readContract({ address: s.chain.d.usdg, abi: Erc20Abi, functionName: "balanceOf", args: [me] });
    expect(Number(w.totals.usdgUsd)).toBeCloseTo(Number(usdg) / 1e6, 1);
  });
});
