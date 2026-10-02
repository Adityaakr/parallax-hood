/* What is the smallest leg the Binance aggregator will actually price? Probes AAPLon (Ondo-only on BSC, no
   usable pool) at increasing sizes; the answer sets Baskets.AGG_MIN_LEG_USD, which sets the index minimums. */
import { BinanceWeb3Client } from "@parallax-hood/binance-client";
const c = new BinanceWeb3Client({ apiKey: process.env.BINANCE_WEB3_API_KEY, apiSecret: process.env.BINANCE_WEB3_API_SECRET, mode: "live" });
const USDT = "0x55d398326f99059fF775485246999027B3197955";
for (const [name, token] of [["AAPLon", "0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4"]] as const) {
  for (const usd of ["5.05", "5.5", "6", "7", "8", "9"]) {
    const amount = (BigInt(Math.round(Number(usd) * 1e6)) * 10n ** 12n).toString();
    try {
      const qs = await c.aggregatedQuote({ binanceChainId: "56", fromTokenAddress: USDT, toTokenAddress: token, amount, userWalletAddress: "0x0047B31C30006BD20469dC47be49aF0013883E2F" });
      const q = qs[0];
      console.log(`${name}\t$${usd}\tok\t${q ? Number(q.toTokenAmount) / 1e18 : "-"}\t${q?.swapPath?.map((s: { name?: string }) => s.name).join("+") ?? ""}`);
    } catch (e) { console.log(`${name}\t$${usd}\trefused\t${(e as Error).message.slice(0, 100)}`); }
  }
}
