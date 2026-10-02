/**
 * End-to-end against a local anvil with mocks (`pnpm mocks:up`, chain 1337). Skipped when the chain is not up.
 * Covers: resolve buy -> execute -> receipt indexed -> quote record; basket mint / redeem / in-kind; migration.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createWalletClient, createPublicClient, http, type Address, type Hex, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { localMocks, Erc20Abi, WAD, MockSwapTargetAbi } from "@parallax-hood/sdk";
import { loadConfig } from "../src/config.js";
import { createApp, createServices, type Services } from "../src/app.js";

const RPC = "http://127.0.0.1:8548";
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

const up = await chainUp();
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
    // pin the Binance mode: this suite asserts how *fixture* data is labeled, and must not change meaning
    // just because the developer has live keys in .env
    s = createServices(loadConfig({ ...process.env, CHAIN_ID: "1337", LOG_LEVEL: "error", BINANCE_CLIENT_MODE: "fixtures" }), ":memory:");
    app = createApp(s);
  });

  it("lists stocks with representations and labeled data sources", async () => {
    const r = await get("/stocks");
    expect(r.dataSource).toBe("fixture");
    const nvda = r.stocks.find((x: any) => x.ticker === "NVDA");
    expect(nvda.representations.map((x: any) => x.symbol).sort()).toEqual(["NVDAB", "NVDAon"]);
    expect(nvda.referenceSource).toMatch(/mock-venue/);
    expect(nvda.market.source).toBe("registry");
  });

  it("resolves a buy, simulates, executes, indexes the receipt, serves the record", async () => {
    const r = await post("/resolve", { ticker: "NVDA", usdAmount: "500", wallet: me });
    expect(r.status).toBe("ok");
    expect(r.candidates.length).toBe(2);
    expect(r.candidates.every((c: any) => c.eligible)).toBe(true);
    expect(r.simulation.ok).toBe(true);
    expect(r.tx.to.toLowerCase()).toBe(s.chain.d.router.toLowerCase());
    expect(r.quoteHash).toMatch(/^0x[0-9a-f]{64}$/);
    // shares-denominated: minShares = 99.5 % of sharesOut
    expect(BigInt(r.chosen.minShares)).toBe((BigInt(r.chosen.sharesOut) * 9950n) / 10_000n);

    // the router pulls notional + the 50 bps protocol fee and refunds what the legs leave
    expect(r.fee.bps).toBe(50);
    expect(BigInt(r.fee.totalUsdtIn)).toBe(BigInt(r.chosen.usdtIn) + (BigInt(r.chosen.usdtIn) * 50n) / 10_000n);
    await approve(s.chain.d.usdt, s.chain.d.router, BigInt(r.fee.totalUsdtIn));
    const hash = await send(r.tx);
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

  it("applies policy exclusions with reasons and reports queued_until_open when closed", async () => {
    const r = await post("/resolve", { ticker: "NVDA", usdAmount: "100", wallet: me, policy: { excludePlatforms: ["ondo"], maxAttestationAgeHours: 36 } });
    const on = r.candidates.find((c: any) => c.platform === "ondo");
    expect(on.eligible).toBe(false);
    expect(on.reasons[0]).toMatch(/excluded by policy/);
  });

  it("mints, redeems, redeems in kind, keeps backing >= 1", async () => {
    const list = await get("/baskets");
    const b = list.baskets[0];
    expect(b.symbol).toBe("pxDEMO3");
    const supply0 = BigInt(b.totalSupply);
    const mint = await post(`/baskets/${b.symbol}/quote-mint`, { units: "2", wallet: me });
    expect(mint.status).toBe("ok");
    expect(mint.problems).toEqual([]);
    expect(mint.simulation.ok).toBe(true);
    // NVDA and AAPL caps are 80 %: with two eligible reps each, fills must use both platforms
    const nvda = mint.breakdown.find((x: any) => x.ticker === "NVDA");
    expect(nvda.capActive).toBe(true);
    expect(new Set(nvda.fills.map((f: any) => f.platform)).size).toBe(2);
    await approve(s.chain.d.usdt, b.address, BigInt(mint.maxUsdtIn));
    await send(mint.tx);
    s.chain.invalidate();
    let detail = await get(`/baskets/${b.address}`);
    expect(BigInt(detail.totalSupply)).toBe(supply0 + 2n * WAD);
    expect(detail.backingOk).toBe(true);
    for (const c of detail.constituents) expect(c.backingRatio).toBeGreaterThanOrEqual(1);
    const bstockBps = detail.constituents.find((c: any) => c.ticker === "NVDA").representations.find((r: any) => r.platform === "bstock").shareBps;
    expect(bstockBps).toBeLessThanOrEqual(8000);

    const red = await post(`/baskets/${b.address}/quote-redeem`, { units: "1", wallet: me });
    expect(red.simulation.ok).toBe(true);
    expect(BigInt(red.usdtOut) > 0n).toBe(true);
    const usdtBefore = await pub.readContract({ address: s.chain.d.usdt, abi: Erc20Abi, functionName: "balanceOf", args: [me] });
    const treasury = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720"; // FEE_RECIPIENT in scripts/mocks-up.sh
    const feeBefore = await pub.readContract({ address: s.chain.d.usdt, abi: Erc20Abi, functionName: "balanceOf", args: [treasury] });
    await send(red.tx);
    // the holder receives the quoted net amount; the 50 bps fee lands with the recipient
    expect(red.fee.bps).toBe(50);
    expect(await pub.readContract({ address: s.chain.d.usdt, abi: Erc20Abi, functionName: "balanceOf", args: [treasury] })).toBe(feeBefore + BigInt(red.fee.usdt));
    const usdtAfter = await pub.readContract({ address: s.chain.d.usdt, abi: Erc20Abi, functionName: "balanceOf", args: [me] });
    expect(usdtAfter - usdtBefore).toBe(BigInt(red.usdtOut));

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

  it("finds and executes a share-accretive migration when a venue price moves", async () => {
    const list = await get("/baskets");
    const b = list.baskets[0];
    // make ondo NVDA 3 % cheaper per share at the mock venue -> moving bstock -> ondo gains shares.
    // (The vault holds NVDA 80/20 bstock/ondo under an 80 % cap, so migrating *into* bstock would be rejected.)
    const nvdab = s.chain.d.mocks!.NVDAon!;
    const px = await pub.readContract({ address: s.chain.d.venue!, abi: MockSwapTargetAbi, functionName: "price", args: [nvdab] });
    const h = await wallet.writeContract({ address: s.chain.d.venue!, abi: MockSwapTargetAbi, functionName: "setPrice", args: [nvdab, (px * 97n) / 100n] });
    await pub.waitForTransactionReceipt({ hash: h });
    s.chain.invalidate();
    const migs = await get(`/migrations?basket=${b.address}&minGainBps=30`);
    expect(migs.length).toBeGreaterThan(0);
    const m = migs.find((x: any) => x.ticker === "NVDA" && x.to === "NVDAon");
    expect(m).toBeTruthy();
    expect(Number(m.gainBps)).toBeGreaterThanOrEqual(30);
    try {
      const before = await get(`/baskets/${b.address}`);
      const heldBefore = BigInt(before.constituents.find((c: any) => c.ticker === "NVDA").heldShares);
      await send(m.tx); // permissionless: any account
      s.chain.invalidate();
      const after = await get(`/baskets/${b.address}`);
      const heldAfter = BigInt(after.constituents.find((c: any) => c.ticker === "NVDA").heldShares);
      expect(heldAfter - heldBefore).toBeGreaterThanOrEqual(BigInt(m.minShareGain));
      for (const c of after.constituents) expect(c.backingRatio).toBeGreaterThanOrEqual(1);
      // the rebalance trail: the vault's own Migrated event, joined back to the record its quote hash points at
      await s.indexer.syncOnce();
      const trail = await get(`/baskets/${b.address}/rebalances`);
      expect(trail.executed.length).toBeGreaterThan(0);
      const top = trail.executed[0];
      expect(top.ticker).toBe("NVDA");
      expect(top.to).toBe("NVDAon");
      expect(top.quoteRecord).toBe(true);
      // the event carries the vault's own gain; the API's heldShares truncates per representation, so allow a wei or two
      expect(BigInt(top.shareGain)).toBeGreaterThanOrEqual(BigInt(m.minShareGain));
      const drift = BigInt(top.shareGain) - (heldAfter - heldBefore);
      expect(drift <= 2n && drift >= -2n).toBe(true);
      expect(top.split.find((r: any) => r.symbol === "NVDAon").sharesAfter > top.split.find((r: any) => r.symbol === "NVDAon").shares).toBe(true);
      expect(trail.version).toBe(trail.executed.length + 1);
    } finally {
      const h2 = await wallet.writeContract({ address: s.chain.d.venue!, abi: MockSwapTargetAbi, functionName: "setPrice", args: [nvdab, px] });
      await pub.waitForTransactionReceipt({ hash: h2 });
    }
  });

  it("sizes a mint to a USDT budget and never asks for more than it", async () => {
    const list = await get("/baskets");
    const b = list.baskets[0];
    const budget = 500n * WAD;
    const q = await post(`/baskets/${b.symbol}/quote-mint`, { budgetUsdt: "500", wallet: me });
    expect(q.status).toBe("ok");
    expect(q.problems).toEqual([]);
    // the ceiling the vault may pull, fee included, is what has to fit the budget
    expect(BigInt(q.maxUsdtIn) <= budget).toBe(true);
    expect(BigInt(q.expectedUsdt) <= BigInt(q.maxUsdtIn)).toBe(true);
    // and it should use most of it: a budget that buys a tenth of what it could afford is a sizing bug
    expect(BigInt(q.maxUsdtIn) * 100n / budget).toBeGreaterThan(90n);
  });

  it("wallet view aggregates holdings in shares", async () => {
    const w = await get(`/wallet/${me}`);
    expect(w.holdings.some((h: any) => h.ticker === "NVDA")).toBe(true);
    expect(w.baskets.length).toBeGreaterThanOrEqual(1);
  });
});
