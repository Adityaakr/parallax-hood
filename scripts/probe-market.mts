/* What history does the Binance RWA API actually carry for a name with no Chainlink feed on BSC? */
import { BinanceWeb3Client } from "@parallax-hood/binance-client";
const c = new BinanceWeb3Client({ apiKey: process.env.BINANCE_WEB3_API_KEY, apiSecret: process.env.BINANCE_WEB3_API_SECRET, mode: "live" });
const HOODB = "0xa394dcea3fd3847fd793afbfd163e2e3858b7c65";
const m = await c.rwaUnderlyingMarket({ binanceChainId: "56", tokenContractAddress: HOODB });
console.log("=== underlying-market"); console.log(JSON.stringify(m, null, 1).slice(0, 2500));
const p = await c.rwaUnderlyingProfile({ binanceChainId: "56", tokenContractAddress: HOODB });
console.log("=== underlying-profile keys", Object.keys(p as object));
console.log(JSON.stringify(p, null, 1).slice(0, 1200));
