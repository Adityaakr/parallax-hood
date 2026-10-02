/**
 * Creates the curated index vaults from contracts/script/config/bsc.json (`indices`), skipping any that already
 * exist in the deployment file. Works on any chain where the core contracts are deployed.
 *
 *   CHAIN_ID=31337 npx tsx scripts/create-indices.ts          # fork
 *   CHAIN_ID=97 npx tsx scripts/create-indices.ts             # BSC testnet (needs DEPLOYER_PRIVATE_KEY)
 *   CHAIN_ID=56 npx tsx scripts/create-indices.ts             # mainnet: one-way door, asks nothing, so be sure
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toBytes } from "viem";
import { BasketFactoryAbi, tickerToId } from "@parallax-hood/sdk";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHAIN_ID = process.env.CHAIN_ID ?? "31337";
const RPC = process.env.RPC_URL ?? (CHAIN_ID === "31337" ? "http://127.0.0.1:8547" : CHAIN_ID === "56" ? "https://bsc-dataseed.binance.org" : CHAIN_ID === "97" ? process.env.BSC_TESTNET_RPC_URL ?? "https://bsc-testnet-rpc.publicnode.com" : "http://127.0.0.1:8548");
const depPath = resolve(ROOT, `contracts/deployments/${CHAIN_ID}.json`);
const dep = JSON.parse(readFileSync(depPath, "utf8")) as Record<string, string> & { factory: Address };
const cfg = JSON.parse(readFileSync(resolve(ROOT, "contracts/script/config/bsc.json"), "utf8")) as {
  indices: { symbol: string; name: string; constituents: { ticker: string; sharesPerUnit: string; maxIssuerBps: number }[] }[];
};

// the fork is driven by anvil key #0; real networks use the configured deployer
const pk = (CHAIN_ID === "31337" || CHAIN_ID === "1337"
  ? process.env.FORK_PRIVATE_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d96d4fd05f9"
  : process.env.DEPLOYER_PRIVATE_KEY) as Hex;
if (!pk) throw new Error("no key: set DEPLOYER_PRIVATE_KEY");
const account = privateKeyToAccount(pk);
const pub = createPublicClient({ transport: http(RPC) });
const wallet = createWalletClient({ account, transport: http(RPC) });

// creating a vault is role-gated; the deployer holds admin on a fresh deployment and grants itself the role
const creatorRole = await pub.readContract({ address: dep.factory, abi: BasketFactoryAbi, functionName: "BASKET_CREATOR_ROLE" });
const canCreate = await pub.readContract({ address: dep.factory, abi: BasketFactoryAbi, functionName: "hasRole", args: [creatorRole, account.address] });
if (!canCreate) {
  const adminRole = await pub.readContract({ address: dep.factory, abi: BasketFactoryAbi, functionName: "DEFAULT_ADMIN_ROLE" });
  const isAdmin = await pub.readContract({ address: dep.factory, abi: BasketFactoryAbi, functionName: "hasRole", args: [adminRole, account.address] });
  if (!isAdmin) throw new Error(`${account.address} holds neither BASKET_CREATOR_ROLE nor admin on ${dep.factory}`);
  const h = await wallet.writeContract({ address: dep.factory, abi: BasketFactoryAbi, functionName: "grantRole", args: [creatorRole, account.address], chain: null });
  await pub.waitForTransactionReceipt({ hash: h });
  console.log(`granted BASKET_CREATOR_ROLE to ${account.address}`);
}

for (const index of cfg.indices) {
  const symKey = keccak256(toBytes(index.symbol)); // the factory keys its map by keccak(symbol)
  // ask the chain, not the deployment file: the file can be stale or half-written
  let address = await pub.readContract({ address: dep.factory, abi: BasketFactoryAbi, functionName: "basketBySymbol", args: [symKey] });
  if (address !== "0x0000000000000000000000000000000000000000") {
    console.log(`${index.symbol.padEnd(8)} exists at ${address}`);
  } else {
    const constituents = index.constituents.map((c) => ({ underlyingId: tickerToId(c.ticker), sharesPerUnit: BigInt(c.sharesPerUnit), maxIssuerBps: c.maxIssuerBps }));
    const hash = await wallet.writeContract({ address: dep.factory, abi: BasketFactoryAbi, functionName: "createBasket", args: [index.name, index.symbol, constituents], chain: null });
    const rcpt = await pub.waitForTransactionReceipt({ hash });
    if (rcpt.status !== "success") throw new Error(`${index.symbol} creation reverted (${hash})`);
    address = await pub.readContract({ address: dep.factory, abi: BasketFactoryAbi, functionName: "basketBySymbol", args: [symKey] });
    console.log(`${index.symbol.padEnd(8)} created at ${address} (${index.constituents.length} constituents, gas ${rcpt.gasUsed})`);
  }
  dep[`basket_${index.symbol}`] = address;
}

writeFileSync(depPath, JSON.stringify(dep, null, 2) + "\n");
console.log(`wrote ${depPath}`);
