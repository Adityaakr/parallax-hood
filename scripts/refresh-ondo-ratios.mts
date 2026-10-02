/* Re-post the keeper ratios for Ondo tokens whose posted value has aged past maxRatioAge, one transaction
   each. The full keeper walks the whole catalogue and posts market state first; when the deployer is low on
   gas this does only the part that restores buy eligibility. Values come from Binance, never invented. */
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BinanceWeb3Client } from "@parallax-hood/binance-client";

const ROOT = resolve(import.meta.dirname, "..");
const dep = JSON.parse(readFileSync(resolve(ROOT, "contracts/deployments/56.json"), "utf8"));
const cfg = JSON.parse(readFileSync(resolve(ROOT, "contracts/script/config/bsc-indices.json"), "utf8"));
const REG = parseAbi([
  "function postedRatio(address) view returns ((uint256 ratio, uint64 updatedAt))",
  "function getRepresentation(address) view returns ((address token, bytes32 underlyingId, bytes32 platformId, uint8 decimals, uint8 ratioSource, bool active, bool exists))",
  "function maxRatioAge() view returns (uint64)",
  "function postRatio(address token, uint256 ratio)",
]);

const rpc = process.env.BSC_RPC_URL ?? "https://bsc-dataseed1.bnbchain.org";
const pub = createPublicClient({ chain: bsc, transport: http(rpc) });
const account = privateKeyToAccount(process.env.KEEPER_PRIVATE_KEY as `0x${string}`);
const wallet = createWalletClient({ account, chain: bsc, transport: http(rpc) });
const binance = new BinanceWeb3Client({ apiKey: process.env.BINANCE_WEB3_API_KEY, apiSecret: process.env.BINANCE_WEB3_API_SECRET, mode: "live" });

const maxAge = await pub.readContract({ address: dep.registry, abi: REG, functionName: "maxRatioAge" });
const live = new Map((await binance.rwaTokens({ binanceChainId: "56" })).map((t) => [t.tokenContractAddress.toLowerCase(), t]));
const now = Math.floor(Date.now() / 1000);
let posted = 0;

for (const r of cfg.representations as { symbol: string; token: string }[]) {
  const token = r.token as `0x${string}`;
  const info = await pub.readContract({ address: dep.registry, abi: REG, functionName: "getRepresentation", args: [token] });
  if (!info.exists || info.ratioSource !== 0) continue; // KEEPER source only; ERC-8056 reads itself
  const p = await pub.readContract({ address: dep.registry, abi: REG, functionName: "postedRatio", args: [token] });
  const age = now - Number(p.updatedAt);
  if (age < Number(maxAge) / 2) continue;
  const t = live.get(token.toLowerCase());
  if (!t?.tokenToShareRatio) { console.log(`${r.symbol.padEnd(8)} no source, skipped`); continue; }
  const ratio = BigInt(Math.round(Number(t.tokenToShareRatio) * 1e12)) * 10n ** 6n;
  const hash = await wallet.writeContract({ address: dep.registry, abi: REG, functionName: "postRatio", args: [token, ratio], gasPrice: 50_000_000n });
  const rec = await pub.waitForTransactionReceipt({ hash });
  console.log(`${r.symbol.padEnd(8)} ${t.tokenToShareRatio}  ${(age / 3600).toFixed(1)}h old  ${rec.status}  ${hash.slice(0, 12)}`);
  posted++;
}
console.log(`posted ${posted}`);
