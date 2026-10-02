/**
 * Hybrid demo done-signal, as a judge would do it: a brand-new wallet asks the faucet for test funds, invests a
 * dollar amount in an index through the resolver's quote, signs on BSC testnet, and the resolver indexes the
 * receipts. Asserts the fill happened at mainnet-mirrored prices (cost per share within the venue fee + mirror
 * drift of the mainnet catalogue price) and that the vault stays backed.
 *
 *   RESOLVER=http://127.0.0.1:4097 pnpm --filter @parallax-hood/scripts e2e:hybrid
 */
import { createPublicClient, createWalletClient, http, parseAbi, formatEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

const RESOLVER = process.env.RESOLVER ?? "http://127.0.0.1:4097";
const RPC = process.env.BSC_TESTNET_RPC_URL ?? "https://bsc-testnet-rpc.publicnode.com";
const SYMBOL = process.env.SYMBOL ?? "pxMAG7";
const USD = process.env.USD ?? "100";
const TOLERANCE_BPS = Number(process.env.TOLERANCE_BPS ?? 60); // venue fee 10 bps + mirror drift 5 bps + rounding, with headroom

const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`${RESOLVER}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await r.json()) as Record<string, any>;
  if (!r.ok) throw new Error(`${path}: ${body.error ?? r.status}`);
  return body;
};
const erc20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);

const health = await api("/health");
if (health.chainId !== 97 || !health.hybrid) throw new Error(`resolver at ${RESOLVER} is not the hybrid testnet (chain ${health.chainId})`);
console.log(`markets: ${health.hybrid.markets}\nexecution: ${health.hybrid.execution}\n`);

// 1. a wallet nobody has seen before
const account = privateKeyToAccount(generatePrivateKey());
const pub = createPublicClient({ chain: bscTestnet, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: bscTestnet, transport: http(RPC) });
console.log(`fresh wallet ${account.address}`);

// 2. faucet
const f = await api("/faucet", { method: "POST", body: JSON.stringify({ address: account.address }) });
console.log(`faucet: ${formatEther(BigInt(f.bnb))} tBNB · ${formatEther(BigInt(f.usdt))} USDT (${f.txHash})`);

// 3. quote the investment in dollars
const q = await api(`/baskets/${SYMBOL}/quote-mint`, { method: "POST", body: JSON.stringify({ usdAmount: USD, wallet: account.address }) });
if (!q.tx) throw new Error(`no executable mint: ${q.problems?.join("; ")}`);
console.log(`\n$${USD} → ${formatEther(BigInt(q.units))} ${SYMBOL} units, expected ${formatEther(BigInt(q.expectedUsdt))} USDT, max ${formatEther(BigInt(q.maxUsdtIn))}`);

// every leg must have filled at (about) the mainnet price of that token
const stocks = await api("/stocks");
let checked = 0;
for (const c of q.breakdown as { ticker: string; fills: { symbol: string; costPerShareUsd: string; shares: string }[] }[]) {
  const stock = stocks.stocks.find((s: { ticker: string }) => s.ticker === c.ticker);
  for (const fill of c.fills) {
    const rep = stock?.representations.find((r: { symbol: string }) => r.symbol === fill.symbol);
    const mainnetPerShare = rep?.binance?.tokenPrice && rep.ratio ? Number(rep.binance.tokenPrice) / (Number(rep.ratio) / 1e18) : null;
    if (mainnetPerShare === null) continue;
    const diffBps = Math.round(((Number(fill.costPerShareUsd) - mainnetPerShare) / mainnetPerShare) * 10_000);
    console.log(`  ${c.ticker.padEnd(6)} ${fill.symbol.padEnd(8)} fill $${Number(fill.costPerShareUsd).toFixed(4)}/share vs mainnet $${mainnetPerShare.toFixed(4)} (${diffBps >= 0 ? "+" : ""}${diffBps} bps)`);
    if (Math.abs(diffBps) > TOLERANCE_BPS) throw new Error(`${fill.symbol} filled ${diffBps} bps away from the mainnet price; the mirror is stale or wrong`);
    checked++;
  }
}
if (checked === 0) throw new Error("no fill could be checked against a mainnet price");

// 4. approve + mint on testnet
const usdt = health.deployment.usdt as Address;
const a = await wallet.writeContract({ address: usdt, abi: erc20, functionName: "approve", args: [q.basket as Address, BigInt(q.maxUsdtIn)] });
await pub.waitForTransactionReceipt({ hash: a });
const h = await wallet.sendTransaction({ to: q.tx.to as Address, data: q.tx.data as Hex, gas: q.tx.gas ? BigInt(q.tx.gas) : undefined });
const rcpt = await pub.waitForTransactionReceipt({ hash: h });
if (rcpt.status !== "success") throw new Error(`mint reverted: ${h}`);
console.log(`\nminted on BSC testnet: https://testnet.bscscan.com/tx/${h} (gas ${rcpt.gasUsed})`);

// 5. the vault is backed and the resolver saw the receipts
const detail = await api(`/baskets/${SYMBOL}`);
if (!detail.backingOk) throw new Error("backing invariant broken after mint");
const units = await pub.readContract({ address: q.basket as Address, abi: erc20, functionName: "balanceOf", args: [account.address] });
console.log(`wallet holds ${formatEther(units)} ${SYMBOL}; backing ok on ${detail.constituents.length} constituents`);
let receipts: { tx_hash: string }[] = [];
for (let i = 0; i < 20 && receipts.length === 0; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  receipts = (await api(`/receipts?actor=${account.address}&limit=20`)).receipts.filter((r: { tx_hash: string }) => r.tx_hash.toLowerCase() === h.toLowerCase());
}
if (receipts.length === 0) throw new Error("resolver did not index the mint receipts within 60 s");
console.log(`${receipts.length} receipts indexed for ${h}\n\nHYBRID E2E OK`);
