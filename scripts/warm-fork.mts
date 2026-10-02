/**
 * Touch every index constituent token once, one at a time, so the fork's backend has their state cached before
 * a burst of contract calls needs it. Parallel first-touch reads are what wedge anvil against a public archive.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, type Address } from "viem";
import { Erc20Abi } from "@parallax-hood/sdk";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = process.env.FORK_RPC_URL ?? "http://127.0.0.1:8547";
const cfg = JSON.parse(readFileSync(resolve(ROOT, "contracts/script/config/bsc.json"), "utf8")) as {
  representations: { ticker: string; token: string }[];
  indices: { constituents: { ticker: string }[] }[];
};
const wanted = new Set(cfg.indices.flatMap((i) => i.constituents.map((c) => c.ticker)));
const tokens = cfg.representations.filter((r) => wanted.has(r.ticker));
const pub = createPublicClient({ transport: http(RPC) });
const dead = "0x000000000000000000000000000000000000dEaD" as Address;

let done = 0;
for (const t of tokens) {
  try {
    await pub.readContract({ address: t.token as Address, abi: Erc20Abi, functionName: "balanceOf", args: [dead] });
    await pub.readContract({ address: t.token as Address, abi: Erc20Abi, functionName: "totalSupply" });
    done++;
  } catch (e) {
    console.warn(`  warm ${t.ticker} failed: ${String(e).slice(0, 80)}`);
  }
}
console.log(`warmed ${done}/${tokens.length} constituent tokens`);
