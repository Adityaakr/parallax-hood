/**
 * Builds contracts/script/config/robinhood.json (and mocks.json from it) from the sources themselves, so no
 * address in either file was typed by hand:
 *
 *   tokens  https://api.robinhood.com/rhj/assets, the list docs.robinhood.com/chain/contracts renders
 *   feeds   https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json, the directory behind
 *           docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood
 *   USDG    docs.paxos.com/guides/stablecoin/usdg/mainnet; WETH from docs.robinhood.com/chain/contracts
 *   router  the Uniswap v3 deployment in packages/uniswap-client
 *
 * and then checks each one on chain 4663: the token has code, 18 decimals, the symbol the API gives and a
 * `uiMultiplier()` equal to the API's; the feed has code, answers `latestRoundData()` with a positive price and
 * describes itself as that ticker; USDG reports 6 decimals. A mismatch stops the run instead of being written.
 *
 *   pnpm --filter @parallax-hood/scripts gen-universe          # writes both files
 *   TICKERS=NVDA,AAPL pnpm --filter @parallax-hood/scripts gen-universe
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, getAddress, parseAbi, type Address } from "viem";
import { robinhood, ROBINHOOD_ADDRESSES } from "@parallax-hood/sdk";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const ASSETS_URL = "https://api.robinhood.com/rhj/assets";
const FEEDS_URL = "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json";
const TICKERS = (process.env.TICKERS ?? "NVDA,AAPL,MSFT,AMZN,GOOGL,META,TSLA").split(",").map((t) => t.trim().toUpperCase());
const UNIT_VALUE_USD = 100;

/** The curated indices: weights only. Shares per unit are computed from today's prices so a unit starts near $100. */
const INDICES = [
  {
    name: "Parallax Magnificent 7", symbol: "pxMAG7",
    thesis: "The seven US megacaps that dominate index returns, equal-weighted so no single name decides the unit.",
    weights: { NVDA: 1, AAPL: 1, MSFT: 1, AMZN: 1, GOOGL: 1, META: 1, TSLA: 1 },
  },
  {
    name: "Parallax AI Compute", symbol: "pxAI",
    thesis: "The chip designer the AI build-out runs on and the three largest buyers of its hardware.",
    weights: { NVDA: 4, MSFT: 2, GOOGL: 2, META: 2 },
  },
] as const;

const client = createPublicClient({ chain: robinhood, transport: http(RPC, { retryCount: 6, retryDelay: 600 }), batch: { multicall: { wait: 20 } } });
const erc20 = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)", "function uiMultiplier() view returns (uint256)"]);
const aggregator = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function decimals() view returns (uint8)", "function description() view returns (string)"]);

type Asset = { tokenSymbol: string; tokenName: string; logoUrl?: string; currentMultiplier: string; status: string; tokenDecimals: number; deployments: { contractAddress: string; chainId: number }[] };
type Feed = { name: string; proxyAddress: string | null; decimals: number; heartbeat: number; threshold: number; docs?: { marketHours?: string } };

const getJson = async <T>(url: string): Promise<T> => {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
};
const fail = (msg: string): never => {
  throw new Error(`verification failed: ${msg}`);
};
const hasCode = async (a: Address) => ((await client.getCode({ address: a })) ?? "0x").length > 2;

const assetsBody = await getJson<Record<string, Asset[]> | Asset[]>(ASSETS_URL);
const assets = Array.isArray(assetsBody) ? assetsBody : Object.values(assetsBody).find(Array.isArray) ?? [];
const feeds = await getJson<Feed[]>(FEEDS_URL);

if ((await client.getChainId()) !== 4663) fail("RPC is not chain 4663");
const usdgDecimals = await client.readContract({ address: ROBINHOOD_ADDRESSES.usdg, abi: erc20, functionName: "decimals" });
if (usdgDecimals !== 6) fail(`USDG reports ${usdgDecimals} decimals`);
for (const [name, a] of Object.entries({ swapRouter02: ROBINHOOD_ADDRESSES.uniswapSwapRouter02, weth: ROBINHOOD_ADDRESSES.weth })) {
  if (!(await hasCode(a))) fail(`${name} ${a} has no code`);
}

const rows = [];
for (const ticker of TICKERS) {
  const asset = assets.find((a) => a.tokenSymbol === ticker) ?? fail(`${ticker} is not in ${ASSETS_URL}`);
  const token = getAddress(asset.deployments.find((d) => d.chainId === 4663)?.contractAddress ?? fail(`${ticker} has no chain 4663 deployment`));
  const feed = feeds.find((f) => f.name === `Robinhood ${ticker} / USD`) ?? fail(`no "Robinhood ${ticker} / USD" feed in ${FEEDS_URL}`);
  const proxy = getAddress(feed.proxyAddress ?? fail(`${ticker} feed has no proxy address`));
  if (!(await hasCode(token))) fail(`${ticker} token ${token} has no code`);
  if (!(await hasCode(proxy))) fail(`${ticker} feed ${proxy} has no code`);
  const [symbol, decimals, multiplier, round, feedDecimals, description] = await Promise.all([
    client.readContract({ address: token, abi: erc20, functionName: "symbol" }),
    client.readContract({ address: token, abi: erc20, functionName: "decimals" }),
    client.readContract({ address: token, abi: erc20, functionName: "uiMultiplier" }),
    client.readContract({ address: proxy, abi: aggregator, functionName: "latestRoundData" }),
    client.readContract({ address: proxy, abi: aggregator, functionName: "decimals" }),
    client.readContract({ address: proxy, abi: aggregator, functionName: "description" }),
  ]);
  if (symbol !== ticker) fail(`${token} symbol is ${symbol}, expected ${ticker}`);
  if (decimals !== 18) fail(`${ticker} has ${decimals} decimals`);
  if (multiplier === 0n) fail(`${ticker} uiMultiplier is zero`);
  // the API prints the multiplier as a decimal; the chain value must be the same number
  if (Math.abs(Number(multiplier) / 1e18 - Number(asset.currentMultiplier)) > 1e-9) fail(`${ticker} multiplier ${multiplier} differs from the API's ${asset.currentMultiplier}`);
  if (round[1] <= 0n) fail(`${ticker} feed answer is ${round[1]}`);
  if (!description.toUpperCase().includes(ticker)) fail(`${ticker} feed describes itself as "${description}"`);
  const tokenPrice = (round[1] * 10n ** 18n) / 10n ** BigInt(feedDecimals); // USD per token, 1e18
  const sharePrice = (tokenPrice * 10n ** 18n) / multiplier; // the feed includes the multiplier
  rows.push({ ticker, token, proxy, multiplier, tokenPrice, sharePrice, updatedAt: Number(round[3]), feedDecimals, heartbeat: feed.heartbeat, deviation: feed.threshold, marketHours: feed.docs?.marketHours ?? null, name: asset.tokenName.replace(/\s*•\s*Robinhood Token$/, ""), logoUrl: asset.logoUrl ?? null, description });
  console.log(`${ticker.padEnd(6)} token ${token}  feed ${proxy}  ${(Number(tokenPrice) / 1e18).toFixed(2)} USD/token  multiplier ${(Number(multiplier) / 1e18).toFixed(9)}`);
}

const indices = INDICES.map((idx) => {
  const total = Object.values(idx.weights).reduce((a, b) => a + b, 0);
  const constituents = Object.entries(idx.weights).map(([ticker, w]) => {
    const row = rows.find((r) => r.ticker === ticker) ?? fail(`${idx.symbol} holds ${ticker}, which is not in TICKERS`);
    const usd = (BigInt(UNIT_VALUE_USD) * 10n ** 18n * BigInt(w)) / BigInt(total);
    return { ticker, weightBps: Math.round((w / total) * 10_000), sharesPerUnit: ((usd * 10n ** 18n) / row.sharePrice).toString(), maxIssuerBps: 10_000 };
  });
  return { name: idx.name, symbol: idx.symbol, thesis: idx.thesis, unitValueUsd: UNIT_VALUE_USD, constituents };
});

const block = await client.getBlock();
const generated = { at: new Date().toISOString(), block: Number(block.number), blockTime: Number(block.timestamp) };
const universe = {
  _note: "Robinhood Chain mainnet (4663). Generated by scripts/gen-universe.mts from the sources named in _sources and checked on chain; do not edit by hand. docs/addresses.md has the source and the check for every address.",
  _sources: { tokens: ASSETS_URL, feeds: FEEDS_URL, usdg: "https://docs.paxos.com/guides/stablecoin/usdg/mainnet", uniswapV3: "https://docs.uniswap.org/contracts/v3/reference/deployments/" },
  _generated: generated,
  chainId: 4663,
  usdg: ROBINHOOD_ADDRESSES.usdg,
  weth: ROBINHOOD_ADDRESSES.weth,
  allowedTargets: [ROBINHOOD_ADDRESSES.uniswapSwapRouter02],
  _allowedTargets_note: "Uniswap v3 SwapRouter02, the only venue routed. It is admin-gated and only ever called by LegExecutor, which trusts balance deltas.",
  priceFeeds: Object.fromEntries(rows.map((r) => [r.ticker, r.proxy])),
  _priceFeeds_note: `Chainlink feeds, ${rows[0]?.feedDecimals} decimals, ${rows[0]?.heartbeat}s heartbeat, ${rows[0]?.deviation}% deviation, schedule ${rows[0]?.marketHours}. Each prices the token with its ERC-8056 multiplier included, so the registry divides by the token's ratio.`,
  brands: Object.fromEntries(rows.map((r) => [r.ticker, { name: r.name, logoUrl: r.logoUrl }])),
  underlyings: rows.map((r) => r.ticker),
  representations: rows.map((r) => ({ ticker: r.ticker, platform: "robinhood", symbol: r.ticker, token: r.token, source: "ERC8056", initialRatio: r.multiplier.toString() })),
  indices,
};
const mocks = {
  _note: "Stand-ins for a network without the real tokens (local anvil, Robinhood Chain Testnet). Generated by scripts/gen-universe.mts from robinhood.json: one ERC-8056 mock per stock, carrying the multiplier and the Chainlink token price its mainnet token had at _generated. These prices are a snapshot, not a live market, and every screen that shows them says so.",
  _generated: generated,
  underlyings: rows.map((r) => r.ticker),
  representations: rows.map((r) => ({ ticker: r.ticker, platform: "robinhood", symbol: r.ticker, mainnetToken: r.token, erc8056: true, ratio: r.multiplier.toString(), tokenPriceUsd: r.tokenPrice.toString() })),
  indices,
};
const dir = resolve(ROOT, "contracts/script/config");
writeFileSync(resolve(dir, "robinhood.json"), JSON.stringify(universe, null, 2) + "\n");
writeFileSync(resolve(dir, "mocks.json"), JSON.stringify(mocks, null, 2) + "\n");
console.log(`\nwrote robinhood.json and mocks.json (${rows.length} stocks, ${indices.length} indices) at block ${generated.block}`);
