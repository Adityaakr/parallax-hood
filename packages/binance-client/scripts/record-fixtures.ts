/**
 * Records real Binance Web3 API responses for the Mag 7 on BSC into fixtures/binance (labeled, replayable).
 *   BINANCE_WEB3_API_KEY=... BINANCE_WEB3_API_SECRET=... pnpm --filter @parallax-hood/binance-client record
 */
import { resolve } from "node:path";
import { BinanceWeb3Client } from "../src/client.js";

const key = process.env.BINANCE_WEB3_API_KEY;
const secret = process.env.BINANCE_WEB3_API_SECRET;
if (!key || !secret) {
  console.error("BINANCE_WEB3_API_KEY / BINANCE_WEB3_API_SECRET are required to record fixtures");
  process.exit(1);
}
const fixturesDir = resolve(process.cwd(), "../../fixtures/binance");
const c = new BinanceWeb3Client({ apiKey: key, apiSecret: secret, mode: "record", fixturesDir, logger: console });
const USDT = "0x55d398326f99059fF775485246999027B3197955";

const platforms = await c.rwaPlatforms();
console.log("platforms", platforms.map((p) => p.platformId));
const mag7 = await c.rwaTokens({ binanceChainId: "56", tabId: 9 });
console.log("mag7 tokens on BSC:", mag7.map((t) => `${t.tokenSymbol}@${t.platformId} ratio=${t.tokenToShareRatio}`));
await c.rwaTokens({ binanceChainId: "56" });
for (const t of ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA"]) await c.rwaSearch({ keyword: t });
const addrs = mag7.map((t) => t.tokenContractAddress);
if (addrs.length) await c.rwaPrice({ binanceChainId: "56", tokenContractAddresses: addrs });
for (const t of mag7) {
  const prof = await c.rwaUnderlyingProfile({ binanceChainId: "56", tokenContractAddress: t.tokenContractAddress });
  console.log(t.tokenSymbol, "attestations:", Object.entries(prof.protections ?? {}).map(([k, v]) => `${k}=${v.url}`).join(" "));
  await c.rwaUnderlyingMarket({ binanceChainId: "56", tokenContractAddress: t.tokenContractAddress });
  try {
    await c.topLiquidityPools({ binanceChainId: "56", tokenContractAddress: t.tokenContractAddress });
  } catch (e) {
    console.warn("top-liquidity failed for", t.tokenSymbol, (e as Error).message);
  }
  for (const usd of ["100", "1000", "10000"]) {
    try {
      const q = await c.aggregatedQuote({
        binanceChainId: "56", fromTokenAddress: USDT, toTokenAddress: t.tokenContractAddress,
        amount: `${usd}000000000000000000`, userWalletAddress: "0x000000000000000000000000000000000000dEaD",
      });
      console.log(t.tokenSymbol, usd, "USDT ->", q.map((x) => `${x.vendorName}:${x.executionMode}:${x.toTokenAmount}`).join(" | "));
    } catch (e) {
      console.warn("quote failed for", t.tokenSymbol, usd, (e as Error).message);
    }
  }
}
console.log("fixtures written to", fixturesDir);
