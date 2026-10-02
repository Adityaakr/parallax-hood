/**
 * Parallax for the seller agent: the resolver's HTTP API (quotes, indices, receipts) plus the one thing the
 * agent may ever sign on its own — an action THROUGH the owner's AgentMandate.
 *
 * Money never reaches the agent. `AgentMandate.agentMintBasket` / `agentBuyShares` pull USDT from the mandate
 * owner, execute through Parallax's vault/router, and send every output to the owner; the contract enforces the
 * per-tx cap, daily cap, expiry and allowlists no matter what this process does. The agent's own wallet only
 * pays gas, and is the identity the owner granted the mandate to.
 *
 * Signing here is FIXED code (Studio rule): the LLM can read plans through tools but can never call
 * {@link executePlan}; that is reached only from the verified ERC-8183 / x402 work path in `work.ts`.
 */
import { readFileSync } from "node:fs";
import { createPublicClient, encodeFunctionData, formatEther, getAddress, http, isAddress, type Address, type Hex } from "viem";
import { bsc, bscTestnet } from "viem/chains";
import { getWallet } from "@bnbagent/studio-runtime/wallet";
import { AgentMandateAbi } from "./abi.js";

export type Leg = { target: Address; data: Hex; tokenIn: Address; maxIn: bigint; tokenOut: Address };

/** Environment: the resolver to quote from and the chain to execute on. Defaults match the hybrid testnet. */
export const CONFIG = (() => {
  const chainId = Number(process.env.PARALLAX_CHAIN_ID ?? 97);
  const chain = chainId === 56 ? bsc : bscTestnet;
  const rpc = process.env.PARALLAX_RPC_URL ?? (chainId === 56 ? "https://bsc-dataseed.binance.org" : "https://bsc-testnet-rpc.publicnode.com");
  let mandate = process.env.PARALLAX_MANDATE as Address | undefined;
  let usdt = process.env.PARALLAX_USDT as Address | undefined;
  if (!mandate || !usdt) {
    // local dev: read the repo's deployment file; deploys set the env instead
    try {
      const dep = JSON.parse(readFileSync(new URL(`../../../../../contracts/deployments/${chainId}.json`, import.meta.url), "utf8")) as { mandate: string; usdt: string };
      mandate ??= getAddress(dep.mandate);
      usdt ??= getAddress(dep.usdt);
    } catch {
      /* stays undefined; execution refuses below */
    }
  }
  return { chainId, chain, rpc, resolver: process.env.RESOLVER_URL ?? "http://127.0.0.1:4097", mandate, usdt, explorer: chainId === 56 ? "https://bscscan.com" : "https://testnet.bscscan.com" };
})();

export const pub = createPublicClient({ chain: CONFIG.chain, transport: http(CONFIG.rpc) });

export async function api(path: string, init?: RequestInit): Promise<Record<string, any>> {
  const r = await fetch(`${CONFIG.resolver}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await r.json().catch(() => ({}))) as Record<string, any>;
  if (!r.ok) throw new Error(`resolver ${path}: ${body.error ?? r.status}`);
  return body;
}

const fmtUsd = (wei: bigint, dp = 2) => (Number(wei / 10n ** 12n) / 1e6).toFixed(dp);
const parseWad = (v: string) => {
  const [i = "0", f = ""] = v.trim().split(".");
  return BigInt(i) * 10n ** 18n + BigInt((f + "0".repeat(18)).slice(0, 18));
};
const tickerToId = (t: string): Hex => `0x${Buffer.from(t.toUpperCase(), "ascii").toString("hex").padEnd(64, "0")}` as Hex;

export function requireMandateContract(): Address {
  if (!CONFIG.mandate) throw new Error(`no AgentMandate address for chain ${CONFIG.chainId}: set PARALLAX_MANDATE (and PARALLAX_USDT)`);
  return CONFIG.mandate;
}

export async function readMandate(id: bigint) {
  const address = requireMandateContract();
  const [m, remaining] = await Promise.all([
    pub.readContract({ address, abi: AgentMandateAbi, functionName: "getMandate", args: [id] }),
    pub.readContract({ address, abi: AgentMandateAbi, functionName: "remainingDaily", args: [id] }),
  ]);
  return {
    id: id.toString(), owner: m.owner, agent: m.agent, active: m.active, expiry: Number(m.expiry), expiryIso: new Date(Number(m.expiry) * 1000).toISOString(),
    perTxCapUsdt: fmtUsd(m.perTxCapUsdt), dailyCapUsdt: fmtUsd(m.dailyCapUsdt), maxSlippageBps: m.maxSlippageBps, spentInWindowUsdt: fmtUsd(m.spentInWindow), remainingDailyUsdt: fmtUsd(remaining),
    isThisAgent: m.agent.toLowerCase() === getWallet().address.toLowerCase(), mandateContract: address,
    _raw: { m, remaining },
  };
}

export type Plan = {
  kind: "invest" | "buy";
  mandateId: bigint;
  owner: Address;
  to: Address;
  data: Hex;
  authorizedUsdt: bigint;
  quoteHash: Hex;
  summary: Record<string, unknown>;
};

/** Plan "invest $usd of the owner's USDT into <index>" through mandate `id`; refuses anything the contract would refuse. */
export async function planInvest(p: { mandateId: bigint; index: string; usd: string }): Promise<Plan> {
  const mandateContract = requireMandateContract();
  const m = await readMandate(p.mandateId);
  const refusals = policyRefusals(m);
  const q = await api(`/baskets/${encodeURIComponent(p.index)}/quote-mint`, { method: "POST", body: JSON.stringify({ usdAmount: p.usd, wallet: m.owner, recipient: m.owner }) });
  if (q.status !== "ok" || !q.legs) throw new Error(`no route for ${p.index}: ${(q.problems ?? []).join("; ") || q.status}`);
  const basket = getAddress(q.basket);
  const allowed = await pub.readContract({ address: mandateContract, abi: AgentMandateAbi, functionName: "allowedBasket", args: [p.mandateId, basket] });
  if (!allowed) refusals.push(`${q.symbol} is not on mandate ${p.mandateId}'s basket allowlist`);
  const maxUsdtIn = BigInt(q.maxUsdtIn);
  if (maxUsdtIn > m._raw.m.perTxCapUsdt) refusals.push(`needs up to ${fmtUsd(maxUsdtIn)} USDT, over the per-tx cap ${m.perTxCapUsdt}`);
  if (maxUsdtIn > m._raw.remaining) refusals.push(`needs up to ${fmtUsd(maxUsdtIn)} USDT, over today's remaining ${m.remainingDailyUsdt}`);
  if (refusals.length) throw new Error(`refused by mandate policy: ${refusals.join("; ")}`);
  const legs = (q.legs as Array<Omit<Leg, "maxIn"> & { maxIn: string }>).map((l) => ({ ...l, maxIn: BigInt(l.maxIn) }));
  const data = encodeFunctionData({ abi: AgentMandateAbi, functionName: "agentMintBasket", args: [p.mandateId, basket, BigInt(q.units), maxUsdtIn, legs, q.quoteHash as Hex] });
  return {
    kind: "invest", mandateId: p.mandateId, owner: m.owner, to: mandateContract, data, authorizedUsdt: maxUsdtIn, quoteHash: q.quoteHash,
    summary: {
      index: q.symbol, basket, units: formatEther(BigInt(q.units)), expectedUsdt: fmtUsd(BigInt(q.expectedUsdt)), maxUsdtIn: fmtUsd(maxUsdtIn), protocolFeeUsdt: q.fee ? fmtUsd(BigInt(q.fee.usdt)) : "0", navPerUnitUsd: q.navPerUnitUsd,
      legs: (q.breakdown as any[]).map((b) => ({ ticker: b.ticker, fills: b.fills.map((f: any) => `${f.symbol} (${f.platform}) ${formatEther(BigInt(f.shares))} sh @ $${f.costPerShareUsd} via ${f.venue}`) })),
      simulation: q.simulation,
    },
  };
}

/** Plan "buy $usd of <ticker> at best execution" through mandate `id`. */
export async function planBuy(p: { mandateId: bigint; ticker: string; usd: string }): Promise<Plan> {
  const mandateContract = requireMandateContract();
  const m = await readMandate(p.mandateId);
  const refusals = policyRefusals(m);
  const uid = tickerToId(p.ticker);
  const amount = parseWad(p.usd);
  const allowed = await pub.readContract({ address: mandateContract, abi: AgentMandateAbi, functionName: "allowedUnderlying", args: [p.mandateId, uid] });
  if (!allowed) refusals.push(`${p.ticker.toUpperCase()} is not on mandate ${p.mandateId}'s stock allowlist`);
  if (amount > m._raw.m.perTxCapUsdt) refusals.push(`${p.usd} USDT is over the per-tx cap ${m.perTxCapUsdt}`);
  if (amount > m._raw.remaining) refusals.push(`${p.usd} USDT is over today's remaining ${m.remainingDailyUsdt}`);
  if (refusals.length) throw new Error(`refused by mandate policy: ${refusals.join("; ")}`);
  const r = await api("/resolve", { method: "POST", body: JSON.stringify({ ticker: p.ticker.toUpperCase(), side: "buy", usdAmount: p.usd, wallet: m.owner, recipient: m.owner }) });
  if (r.status !== "ok" || !r.chosen) throw new Error(`no route: ${r.status}. ${(r.candidates ?? []).map((c: any) => `${c.symbol}: ${c.reasons.join("; ") || "ok"}`).join(" | ")}`);
  const legs = (r.chosen.legs as Array<Omit<Leg, "maxIn"> & { maxIn: string }>).map((l) => ({ ...l, maxIn: BigInt(l.maxIn) }));
  // the router pulls the notional plus the protocol fee; the mandate authorizes that total
  const total = BigInt(r.fee?.totalUsdtIn ?? amount);
  if (total > m._raw.m.perTxCapUsdt) throw new Error(`refused by mandate policy: ${fmtUsd(total)} USDT incl. fee is over the per-tx cap ${m.perTxCapUsdt}`);
  if (total > m._raw.remaining) throw new Error(`refused by mandate policy: ${fmtUsd(total)} USDT incl. fee is over today's remaining ${m.remainingDailyUsdt}`);
  const data = encodeFunctionData({ abi: AgentMandateAbi, functionName: "agentBuyShares", args: [p.mandateId, uid, total, BigInt(r.chosen.minShares), legs, r.quoteHash as Hex] });
  return {
    kind: "buy", mandateId: p.mandateId, owner: m.owner, to: mandateContract, data, authorizedUsdt: total, quoteHash: r.quoteHash,
    summary: {
      ticker: p.ticker.toUpperCase(), usd: p.usd, protocolFeeUsdt: r.fee ? fmtUsd(BigInt(r.fee.usdt)) : "0", sharesOut: formatEther(BigInt(r.chosen.sharesOut)), minShares: formatEther(BigInt(r.chosen.minShares)), why: r.chosen.why,
      candidates: (r.candidates as any[]).map((c) => ({ symbol: c.symbol, platform: c.platform, costPerShareUsd: c.costPerShareUsd, premiumBps: c.premiumBps, eligible: c.eligible, reasons: c.reasons })),
      referencePrice: r.referencePrice, referenceSource: r.referenceSource, simulation: r.simulation,
    },
  };
}

function policyRefusals(m: Awaited<ReturnType<typeof readMandate>>): string[] {
  const out: string[] = [];
  if (m.owner === "0x0000000000000000000000000000000000000000") return [`mandate ${m.id} does not exist`];
  if (!m.isThisAgent) out.push(`mandate ${m.id} names agent ${m.agent}, this agent is ${getWallet().address}`);
  if (!m.active) out.push(`mandate ${m.id} is revoked`);
  if (m.expiry <= Date.now() / 1000) out.push(`mandate ${m.id} expired at ${m.expiryIso}`);
  return out;
}

/**
 * Sign the planned mandate call with the agent's wallet and broadcast it. Simulates first (from the agent) so a
 * contract refusal is reported, never sent. Returns the tx hash and the Parallax receipts the resolver indexed.
 */
export async function executePlan(plan: Plan) {
  const wallet = getWallet();
  const from = getAddress(wallet.address);
  const gas = await pub.estimateGas({ account: from, to: plan.to, data: plan.data });
  const [nonce, gasPrice] = await Promise.all([pub.getTransactionCount({ address: from, blockTag: "pending" }), pub.getGasPrice()]);
  const signed = await wallet.signTransaction({ chainId: CONFIG.chainId, to: plan.to, data: plan.data, value: 0n, gas: (gas * 12n) / 10n, gasPrice, nonce, type: "legacy" });
  const hash = await pub.sendRawTransaction({ serializedTransaction: signed.rawTransaction });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") throw new Error(`mandate call reverted: ${hash}`);
  let receipts: unknown[] = [];
  for (let i = 0; i < 10 && receipts.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    receipts = ((await api(`/receipts/${hash}`).catch(() => ({ receipts: [] }))).receipts ?? []) as unknown[];
  }
  return { txHash: hash, explorer: `${CONFIG.explorer}/tx/${hash}`, gasUsed: rcpt.gasUsed.toString(), blockNumber: Number(rcpt.blockNumber), receipts };
}

export function isAddressLike(v: unknown): v is Address {
  return typeof v === "string" && isAddress(v);
}
