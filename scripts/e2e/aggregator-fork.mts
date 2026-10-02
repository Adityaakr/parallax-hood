/**
 * M1 done-signal: prove a Binance-aggregator route is executable from ShareRouter on a BSC mainnet fork.
 *
 * Buys NVDA with USDT through the aggregator's router, as a leg, and asserts the recipient received at
 * least `minShares` underlying shares. Calldata is fetched live because aggregator quotes are priced per
 * request; that is the whole point of the test.
 *
 *   ALLOWLIST=1 pnpm --filter @parallax-hood/scripts e2e:aggregator     # allowlists the router first (admin tx)
 *   pnpm --filter @parallax-hood/scripts e2e:aggregator                 # expects it to already be allowlisted
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { BinanceWeb3Client } from "@parallax-hood/binance-client";
import { ShareRouterAbi, StockRegistryAbi, Erc20Abi, tickerToId, sharesForTokens } from "@parallax-hood/sdk";

// paths resolve against the repo root, not the cwd, so this runs the same from root or from scripts/
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RPC = process.env.FORK_RPC_URL ?? "http://127.0.0.1:8547";
const TICKER = process.env.TICKER ?? "NVDA";
const USD = BigInt(process.env.USD ?? "200") * 10n ** 18n;
const SLIPPAGE_BPS = 100n; // the quote is live; allow 1% before minShares trips

const dep = JSON.parse(readFileSync(resolve(ROOT, "contracts/deployments/31337.json"), "utf8")) as {
  registry: Address; router: Address; usdt: Address; admin: Address;
};
const rep = (JSON.parse(readFileSync(resolve(ROOT, "contracts/script/config/bsc.json"), "utf8")) as {
  representations: { ticker: string; platform: string; symbol: string; token: string }[];
}).representations.filter((r) => r.ticker === TICKER);

// the fork is deployed by anvil key #0; real-network keys in .env must never be used here
const pk = (process.env.FORK_PRIVATE_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d96d4fd05f9") as Hex;
const account = privateKeyToAccount(pk);
const pub = createPublicClient({ transport: http(RPC) });
const wallet = createWalletClient({ account, transport: http(RPC) });
const binance = new BinanceWeb3Client({ apiKey: process.env.BINANCE_WEB3_API_KEY!, apiSecret: process.env.BINANCE_WEB3_API_SECRET!, mode: "live" });

const fail = (msg: string): never => {
  console.error(`\nFAIL: ${msg}`);
  process.exit(1);
};

// pick the representation the aggregator quotes best, exactly as the resolver would
async function bestRoute() {
  let best: { token: Address; symbol: string; out: bigint; venues: string; quoteId: string; approveTarget: Address } | null = null;
  for (const r of rep) {
    const q = (await binance.aggregatedQuote({
      binanceChainId: "56", fromTokenAddress: dep.usdt, toTokenAddress: r.token, amount: USD.toString(), userWalletAddress: dep.router,
    }))[0];
    if (!q?.toTokenAmount) continue;
    const out = BigInt(q.toTokenAmount);
    const venues = ((q.dexRouterList ?? []) as { dexProtocol?: { dexName?: string } }[]).map((d) => d.dexProtocol?.dexName).join("+");
    console.log(`  ${r.symbol.padEnd(8)} ${out} raw via ${venues}`);
    if (!best || out > best.out) best = { token: r.token as Address, symbol: r.symbol, out, venues, quoteId: String(q.quoteId), approveTarget: q.approveTarget as Address };
  }
  return best ?? fail("no aggregator route for any representation");
}

console.log(`fork ${RPC} · router ${dep.router} · taker-account ${account.address}`);
console.log(`quoting ${TICKER} for ${USD / 10n ** 18n} USDT, taker = ShareRouter`);
const route = await bestRoute();
console.log(`chosen ${route.symbol} via ${route.venues} · approveTarget ${route.approveTarget}`);

const swap = await binance.buildSwapTransaction({
  binanceChainId: "56", fromTokenAddress: dep.usdt, toTokenAddress: route.token, amount: USD.toString(),
  userWalletAddress: dep.router, quoteId: route.quoteId, slippagePercent: "1",
});
const tx = (swap as { tx?: { to: Address; data: Hex } }).tx ?? (swap as unknown as { to: Address; data: Hex });
if (!tx?.to || !tx?.data) fail(`swap endpoint returned no calldata: ${JSON.stringify(swap).slice(0, 200)}`);
console.log(`calldata ${tx.data.length} bytes to ${tx.to}`);

// shares the router must credit, after slippage
const ratio = await pub.readContract({ address: dep.registry, abi: StockRegistryAbi, functionName: "ratioOf", args: [route.token] });
const expectedShares = sharesForTokens(route.out, ratio[0]);
const minShares = (expectedShares * (10_000n - SLIPPAGE_BPS)) / 10_000n;
console.log(`expected ${expectedShares} shares · minShares ${minShares} (ratio ${ratio[0]})`);

// fund + approve
const usdtBal = await pub.readContract({ address: dep.usdt, abi: Erc20Abi, functionName: "balanceOf", args: [account.address] });
if (usdtBal < USD) fail(`${account.address} holds ${usdtBal} USDT, needs ${USD}; run scripts/fork-up.sh`);
const approveHash = await wallet.writeContract({ address: dep.usdt, abi: parseAbi(["function approve(address,uint256) returns (bool)"]), functionName: "approve", args: [dep.router, USD], chain: null });
await pub.waitForTransactionReceipt({ hash: approveHash });

if (process.env.ALLOWLIST === "1") {
  const h = await wallet.writeContract({ address: dep.registry, abi: StockRegistryAbi, functionName: "setAllowedTarget", args: [tx.to, true], chain: null });
  await pub.waitForTransactionReceipt({ hash: h });
  console.log(`allowlisted ${tx.to}`);
}
const allowed = await pub.readContract({ address: dep.registry, abi: StockRegistryAbi, functionName: "isAllowedTarget", args: [tx.to] });
console.log(`target allowlisted: ${allowed}`);

const before = await pub.readContract({ address: route.token, abi: Erc20Abi, functionName: "balanceOf", args: [account.address] });
const leg = { target: tx.to, data: tx.data, tokenIn: dep.usdt, maxIn: USD, tokenOut: route.token };
const data = encodeFunctionData({
  abi: ShareRouterAbi, functionName: "buyShares",
  args: [tickerToId(TICKER), USD, minShares, [leg], account.address, ("0x" + "11".repeat(32)) as Hex],
});
try {
  const gas = await pub.estimateGas({ account, to: dep.router, data });
  const hash = await wallet.sendTransaction({ to: dep.router, data, gas: (gas * 12n) / 10n, chain: null });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") fail(`buyShares reverted onchain (${hash})`);
  const after = await pub.readContract({ address: route.token, abi: Erc20Abi, functionName: "balanceOf", args: [account.address] });
  const gotShares = sharesForTokens(after - before, ratio[0]);
  console.log(`\nreceived ${after - before} ${route.symbol} = ${gotShares} shares (gas ${rcpt.gasUsed})`);
  if (gotShares < minShares) fail(`received ${gotShares} shares < minShares ${minShares}`);
  console.log(`PASS: aggregator leg executed through ShareRouter via ${route.venues}`);
} catch (e) {
  fail(`buyShares failed: ${String(e).slice(0, 400)}`);
}
