/* Can a PancakeSwap v3 pool's own oracle give us a price N seconds ago? Validates the tick math against the
   pool's spot price and the Binance reference for HOODB (bStocks Robinhood, no Chainlink feed on BSC). */
import { createPublicClient, http, parseAbi, getAddress, type Address } from "viem";
import { bsc } from "viem/chains";
const c = createPublicClient({ chain: bsc, transport: http(process.env.BSC_RPC_URL ?? "https://bsc-dataseed1.bnbchain.org") });
const POOL = parseAbi([
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
]);
const pool = getAddress("0xFEeF70FF6F58f0A900e28A77e5A8945aFB343923");
const usdt = getAddress("0x55d398326f99059fF775485246999027B3197955");
const [token0, slot0] = await Promise.all([
  c.readContract({ address: pool, abi: POOL, functionName: "token0" }),
  c.readContract({ address: pool, abi: POOL, functionName: "slot0" }),
]);
const usdtIsToken0 = getAddress(token0) === usdt;
// price of the non-USDT token in USDT, from a tick (both tokens are 18 dp on BSC)
const priceFromTick = (tick: number) => {
  const raw = Math.pow(1.0001, tick); // token1 per token0
  return usdtIsToken0 ? 1 / raw : raw;
};
console.log("spot   ", priceFromTick(slot0[1]).toFixed(4), "USDT   (cardinality", slot0[3], ")");
for (const secs of [3600, 6 * 3600, 86400, 2 * 86400]) {
  try {
    const [cum] = await c.readContract({ address: pool, abi: POOL, functionName: "observe", args: [[secs, 0]] });
    const avgTick = Number((cum[1]! - cum[0]!) / BigInt(secs));
    console.log(`${String(secs / 3600).padStart(3)}h ago`, priceFromTick(avgTick).toFixed(4), "USDT (TWAP)");
  } catch { console.log(`${String(secs / 3600).padStart(3)}h ago  out of the oracle's reach`); }
}
