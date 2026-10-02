/**
 * Mint one unit of every index through the resolver on a chain you own (the local mocks chain or a fork of
 * mainnet) and assert the vault's backing invariant holds afterwards: held shares are at least
 * units × sharesPerUnit for every constituent.
 *
 *   CHAIN_ID=1337  RPC_URL=http://127.0.0.1:8648 RESOLVER=http://127.0.0.1:4100 pnpm --filter @parallax-hood/scripts e2e:index-mint
 *   CHAIN_ID=31337 RPC_URL=http://127.0.0.1:8647 RESOLVER=http://127.0.0.1:4100 pnpm --filter @parallax-hood/scripts e2e:index-mint
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RPC = process.env.RPC_URL ?? process.env.FORK_RPC_URL ?? "http://127.0.0.1:8647";
const RESOLVER = process.env.RESOLVER ?? "http://127.0.0.1:4100";
const CHAIN_ID = process.env.CHAIN_ID ?? "31337";
const UNITS = process.env.UNITS ?? "1";

const dep = JSON.parse(readFileSync(resolve(ROOT, `contracts/deployments/${CHAIN_ID}.json`), "utf8")) as Record<string, string>;
const pk = (process.env.FORK_PRIVATE_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d96d4fd05f9") as Hex;
const account = privateKeyToAccount(pk);
const pub = createPublicClient({ transport: http(RPC) });
const wallet = createWalletClient({ account, transport: http(RPC) });
const erc20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`${RESOLVER}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await r.json()) as Record<string, any>;
  if (!r.ok) throw new Error(`${path}: ${body.error ?? r.status}`);
  return body;
};

let failures = 0;
const symbols = Object.keys(dep).filter((k) => k.startsWith("basket_")).map((k) => k.slice(7));
console.log(`minting ${UNITS} unit of each index on chain ${CHAIN_ID}: ${symbols.join(", ")}\n`);

for (const symbol of symbols) {
  try {
    const quote = await api(`/baskets/${symbol}/quote-mint`, { method: "POST", body: JSON.stringify({ units: UNITS, wallet: account.address }) });
    if (!quote.tx) {
      console.log(`${symbol.padEnd(8)} SKIP, no mint transaction: ${quote.problems?.join("; ") || "unknown"}`);
      failures++;
      continue;
    }
    const cost = Number(quote.expectedUsdg) / 1e6; // USDG has 6 decimals
    const fills = quote.breakdown.flatMap((b: any) => b.fills.map((f: any) => `${b.ticker}:${f.symbol}`));
    await pub.waitForTransactionReceipt({
      hash: await wallet.writeContract({ address: quote.usdg as Address, abi: erc20, functionName: "approve", args: [quote.basket as Address, BigInt(quote.maxUsdgIn)], chain: null }),
    });
    const hash = await wallet.sendTransaction({ to: quote.tx.to as Address, data: quote.tx.data as Hex, gas: quote.tx.gas ? (BigInt(quote.tx.gas) * 13n) / 10n : undefined, chain: null });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success") throw new Error(`mint reverted (${hash})`);

    const units = await pub.readContract({ address: quote.basket as Address, abi: erc20, functionName: "balanceOf", args: [account.address] });
    // the resolver memoizes a vault's composition for a second and a half; read after that, or the check
    // would be made against the vault as it was before this mint
    await new Promise((r) => setTimeout(r, 2_000));
    const after = await api(`/baskets/${symbol}`);
    const worst = after.constituents.reduce((m: number, c: any) => Math.min(m, c.backingRatio ?? 99), 99);
    const ok = after.backingOk && worst >= 1 && worst < 99 && units > 0n; // 99: no constituent reported a ratio
    console.log(`${symbol.padEnd(8)} ${ok ? "PASS" : "FAIL"} · paid ${cost.toFixed(2)} USDG · units ${Number(units) / 1e18} · backing ${after.backingOk ? "ok" : "BROKEN"} (worst ${worst}) · gas ${rcpt.gasUsed}`);
    console.log(`         fills: ${fills.join(", ")}`);
    if (!ok) failures++;
  } catch (e) {
    console.log(`${symbol.padEnd(8)} FAIL: ${String(e).slice(0, 200)}`);
    failures++;
  }
}

if (failures) {
  console.error(`\n${failures} index(es) failed`);
  process.exit(1);
}
console.log("\nPASS: every index minted and kept backing >= 1.00 on every constituent");
