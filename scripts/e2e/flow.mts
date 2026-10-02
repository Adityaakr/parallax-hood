/**
 * The whole product flow on a deployed network, with real transactions, written down as it goes:
 *
 *   owner   buys a stock, deposits into the Mag 7 vault, redeems to USDG, redeems in kind
 *   owner   creates a mandate for the agent: 100 USDG per trade, 150 a day, NVDA and pxMAG7 only
 *   agent   buys and mints within it, through the MCP server's one write tool
 *   agent   asks for three things outside it and is refused before anything is sent
 *   agent   calls the mandate contract directly, around the server, and the contract itself reverts
 *   owner   revokes, and the agent is refused again
 *
 * Meant for the testnet deployment (chain 46630) and for local chains. It refuses mainnet: nothing here should
 * spend real funds without someone deciding to.
 *
 *   set -a; . ./.env; set +a
 *   CHAIN_ID=46630 RESOLVER=http://127.0.0.1:4146 pnpm --filter @parallax-hood/scripts e2e:flow
 *
 * Needs DEPLOYER_PRIVATE_KEY (the owner, holding USDG) and AGENT_PRIVATE_KEY in the environment, a resolver for
 * the chain, and `pnpm --filter @parallax-hood/mcp build`. OUT=<file> also writes the run as markdown.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createPublicClient, createWalletClient, http, parseEther, BaseError, ContractFunctionRevertedError, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAINS, NETWORK_LABEL, chainIdToNetwork, parseDeployment, Erc20Abi, AgentMandateAbi, parseUsdg, formatUsdg, formatWad, tickerToId, deserializeLegs } from "@parallax-hood/sdk";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 46630);
if (CHAIN_ID === 4663) throw new Error("this script does not run on mainnet");
const network = chainIdToNetwork(CHAIN_ID);
const chain = CHAINS[network];
const RPC = process.env.RPC_URL ?? chain.rpcUrls.default.http[0]!;
const RESOLVER = process.env.RESOLVER ?? "http://127.0.0.1:4100";
const need = (k: string) => process.env[k] ?? (() => { throw new Error(`${k} is not set`); })();
const owner = privateKeyToAccount(need("DEPLOYER_PRIVATE_KEY") as Hex);
const AGENT_PK = need("AGENT_PRIVATE_KEY") as Hex;
const agent = privateKeyToAccount(AGENT_PK);
const dep = parseDeployment(JSON.parse(readFileSync(resolve(ROOT, `contracts/deployments/${CHAIN_ID}.json`), "utf8")));
const pub = createPublicClient({ chain, transport: http(RPC, { retryCount: 5, retryDelay: 600 }) });
const ownerWallet = createWalletClient({ account: owner, chain, transport: http(RPC) });
const agentWallet = createWalletClient({ account: agent, chain, transport: http(RPC) });
const explorer = chain.blockExplorers?.default.url ?? null;
const link = (hash: string) => (explorer ? `[\`${hash.slice(0, 10)}…\`](${explorer}/tx/${hash})` : `\`${hash}\``);
const bal = (token: Address, who: Address) => pub.readContract({ address: token, abi: Erc20Abi, functionName: "balanceOf", args: [who] });

const rows: { who: string; step: string; result: string; tx: string }[] = [];
const note = (who: string, step: string, result: string, hash?: string) => {
  rows.push({ who, step, result, tx: hash ? link(hash) : "none sent" });
  console.log(`${who.padEnd(6)} ${step}: ${result}${hash ? `  ${hash}` : ""}`);
};
const api = async (path: string, body?: unknown) => {
  const r = await fetch(`${RESOLVER}${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = (await r.json()) as Record<string, any>;
  if (!r.ok) throw new Error(`${path}: ${j.error ?? r.status}`);
  return j;
};
const send = async (tx: { to: string; data: string; gas?: string }) => {
  const hash = await ownerWallet.sendTransaction({ to: tx.to as Address, data: tx.data as Hex, gas: tx.gas ? (BigInt(tx.gas) * 13n) / 10n : undefined });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") throw new Error(`reverted: ${hash}`);
  return hash;
};
const approve = async (token: Address, spender: Address, amount: bigint) => {
  if ((await pub.readContract({ address: token, abi: Erc20Abi, functionName: "allowance", args: [owner.address, spender] })) >= amount) return;
  await pub.waitForTransactionReceipt({ hash: await ownerWallet.writeContract({ address: token, abi: Erc20Abi, functionName: "approve", args: [spender, amount] }) });
};
/** The custom error a call would revert with, by name, without sending it. */
const revertOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (e) {
    const r = e instanceof BaseError ? (e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | undefined) : undefined;
    return r?.data ? `${r.data.errorName}(${(r.data.args ?? []).map(String).join(", ")})` : String((e as Error).message).split("\n")[0]!.slice(0, 160);
  }
};

const health = await api("/health");
if (health.chainId !== CHAIN_ID) throw new Error(`the resolver at ${RESOLVER} is on chain ${health.chainId}, not ${CHAIN_ID}`);
const stocks = await api("/stocks");
const nvda = stocks.stocks.find((s: any) => s.ticker === "NVDA").representations[0].token as Address;
const basket = dep.baskets.pxMAG7!;
console.log(`${NETWORK_LABEL[network].name} (${CHAIN_ID}), mocked: ${health.label.mocked.join(", ") || "nothing"}\nowner ${owner.address}\nagent ${agent.address}\n`);

// ---- the owner's own trades ----
{
  const q = await api("/resolve", { ticker: "NVDA", usdAmount: "100", wallet: owner.address });
  if (!q.chosen) throw new Error(`no route: ${q.candidates.map((c: any) => c.reasons.join("; ")).join(" | ")}`);
  // the quote was simulated with the allowance overridden; approve exactly what this quote pulls, then send it
  await approve(dep.usdg, dep.router, BigInt(q.fee.totalUsdgIn));
  const before = await bal(nvda, owner.address);
  const hash = await send(q.tx);
  note("owner", "buy 100 USDG of NVDA", `${formatWad((await bal(nvda, owner.address)) - before, 6)} NVDA for ${formatUsdg(BigInt(q.fee.totalUsdgIn))} USDG, fee included, via ${q.candidates[0].venue}`, hash);
}
{
  const q = await api("/baskets/pxMAG7/quote-mint", { budgetUsdg: "200", wallet: owner.address });
  if (!q.tx) throw new Error(`mint: ${q.problems.join("; ") || q.simulation?.error}`);
  // a second quote would be sized again and could pull a little more than the first one's ceiling
  await approve(dep.usdg, basket, BigInt(q.maxUsdgIn));
  const before = await bal(basket, owner.address);
  const usdgBefore = await bal(dep.usdg, owner.address);
  const hash = await send(q.tx);
  note("owner", "deposit 200 USDG into pxMAG7", `${formatWad((await bal(basket, owner.address)) - before, 4)} units for ${formatUsdg(usdgBefore - (await bal(dep.usdg, owner.address)), 2)} USDG, ${q.legs.length} stocks bought in one transaction`, hash);
  await new Promise((r) => setTimeout(r, 2_000));
  const d = await api("/baskets/pxMAG7");
  note("owner", "vault backing after the deposit", `${d.backingOk ? "every constituent backed" : "BROKEN"}, tightest ratio ${Math.min(...d.constituents.map((c: any) => c.backingRatio ?? 99)).toFixed(4)}`);
}
{
  const q = await api("/baskets/pxMAG7/quote-redeem", { units: "0.5", wallet: owner.address });
  if (!q.tx) throw new Error(`redeem: ${q.simulation?.error}`);
  const before = await bal(dep.usdg, owner.address);
  const hash = await send(q.tx);
  note("owner", "redeem 0.5 units to USDG", `${formatUsdg((await bal(dep.usdg, owner.address)) - before, 2)} USDG received, net of the fee`, hash);
}
{
  const q = await api("/baskets/pxMAG7/quote-redeem", { units: "0.25", inKind: true, wallet: owner.address });
  const hash = await send(q.tx);
  note("owner", "redeem 0.25 units in kind", `${q.slices.length} stock tokens returned to the wallet, no venue and no price feed involved`, hash);
}

// ---- the mandate ----
await approve(dep.usdg, dep.mandate, parseUsdg("1000"));
const expiry = BigInt(Number((await pub.getBlock()).timestamp) + 7 * 86_400);
{
  const hash = await ownerWallet.writeContract({ address: dep.mandate, abi: AgentMandateAbi, functionName: "createMandate", args: [agent.address, parseUsdg("100"), parseUsdg("150"), expiry, 300, [tickerToId("NVDA")], [basket]] });
  await pub.waitForTransactionReceipt({ hash });
  note("owner", "create a mandate for the agent", "100 USDG per trade, 150 per day, NVDA and pxMAG7 only, 300 bps floor, 7 days", hash);
}
const id = (await pub.readContract({ address: dep.mandate, abi: AgentMandateAbi, functionName: "nextId" })) - 1n;
if ((await pub.getBalance({ address: agent.address })) < parseEther("0.0002")) {
  await pub.waitForTransactionReceipt({ hash: await ownerWallet.sendTransaction({ to: agent.address, value: parseEther("0.0006") }) });
}

// ---- the agent, through the MCP server ----
const client = new Client({ name: "parallax-flow", version: "0" });
await client.connect(new StdioClientTransport({
  command: "node", args: [resolve(ROOT, "apps/mcp/dist/index.js")], stderr: "pipe",
  env: { ...process.env, CHAIN_ID: String(CHAIN_ID), RPC_URL: RPC, RESOLVER_URL: RESOLVER, AGENT_PRIVATE_KEY: AGENT_PK, NODE_NO_WARNINGS: "1" } as Record<string, string>,
}));
const tool = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { isError: Boolean(r.isError), text: ((r.content as { text: string }[])[0]?.text ?? "") as string };
};
const net = JSON.parse((await tool("get_network")).text);
note("agent", "get_network", `${net.name} (${net.kind}); mocked: ${net.mocked.join(", ") || "nothing"}`);
{
  const before = await bal(nvda, owner.address);
  const r = await tool("execute_with_mandate", { mandate_id: id.toString(), action: "buy_shares", params: { ticker: "NVDA", usd_amount: "50" } });
  if (r.isError) throw new Error(`agent buy: ${r.text}`);
  const j = JSON.parse(r.text);
  note("agent", "buy 50 USDG of NVDA under the mandate", `owner received ${formatWad((await bal(nvda, owner.address)) - before, 6)} NVDA; agent holds ${await bal(nvda, agent.address)} NVDA and ${await bal(dep.usdg, agent.address)} USDG`, j.txHash);
}
{
  const before = await bal(basket, owner.address);
  const r = await tool("execute_with_mandate", { mandate_id: id.toString(), action: "mint_basket", params: { basket: "pxMAG7", units: "0.4" } });
  if (r.isError) throw new Error(`agent mint: ${r.text}`);
  note("agent", "mint 0.4 pxMAG7 under the mandate", `owner received ${formatWad((await bal(basket, owner.address)) - before, 4)} units`, JSON.parse(r.text).txHash);
}
for (const [step, params] of [
  ["ask for 120 USDG of NVDA", { ticker: "NVDA", usd_amount: "120" }],
  ["ask for 10 USDG of AAPL", { ticker: "AAPL", usd_amount: "10" }],
  ["ask for 70 USDG of NVDA", { ticker: "NVDA", usd_amount: "70" }],
] as const) {
  const r = await tool("execute_with_mandate", { mandate_id: id.toString(), action: "buy_shares", params });
  note("agent", step, r.isError ? `refused: ${r.text.replace("refused by mandate policy: ", "").slice(0, 140)}` : "NOT REFUSED");
  if (!r.isError) throw new Error(`${step} was not refused`);
}

// ---- the agent, around the server: the contract is what holds the line ----
{
  const q = await api("/resolve", { ticker: "NVDA", usdAmount: "100", wallet: owner.address, recipient: owner.address });
  const legs = deserializeLegs(q.chosen.legs);
  const over = await revertOf(() => pub.simulateContract({ account: agent, address: dep.mandate, abi: AgentMandateAbi, functionName: "agentBuyShares", args: [id, tickerToId("NVDA"), parseUsdg("101"), 1n, legs, q.quoteHash] }));
  note("agent", "call AgentMandate directly for 101 USDG", `contract reverts: ${over ?? "DID NOT REVERT"}`);
  const aapl = await api("/resolve", { ticker: "AAPL", usdAmount: "10", wallet: owner.address, recipient: owner.address });
  const off = await revertOf(() => pub.simulateContract({ account: agent, address: dep.mandate, abi: AgentMandateAbi, functionName: "agentBuyShares", args: [id, tickerToId("AAPL"), parseUsdg("10"), 1n, deserializeLegs(aapl.chosen.legs), aapl.quoteHash] }));
  note("agent", "call AgentMandate directly for AAPL", `contract reverts: ${off ?? "DID NOT REVERT"}`);
  if (!over || !off) throw new Error("an out-of-bounds call did not revert");
  // and one sent for real, so the refusal is on the explorer and not only in a simulation
  const hash = await agentWallet.writeContract({ address: dep.mandate, abi: AgentMandateAbi, functionName: "agentBuyShares", args: [id, tickerToId("NVDA"), parseUsdg("101"), 1n, legs, q.quoteHash], gas: 900_000n });
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  note("agent", "send the 101 USDG call anyway", `transaction ${rcpt.status === "reverted" ? "reverted on chain, nothing moved" : "DID NOT REVERT"}`, hash);
  if (rcpt.status !== "reverted") throw new Error("the over-cap transaction did not revert");
}

// ---- revocation ----
{
  const hash = await ownerWallet.writeContract({ address: dep.mandate, abi: AgentMandateAbi, functionName: "revoke", args: [id] });
  await pub.waitForTransactionReceipt({ hash });
  note("owner", "revoke the mandate", "one transaction", hash);
  const r = await tool("execute_with_mandate", { mandate_id: id.toString(), action: "buy_shares", params: { ticker: "NVDA", usd_amount: "5" } });
  note("agent", "ask for 5 USDG of NVDA after revocation", r.isError ? `refused: ${r.text.replace("refused by mandate policy: ", "").slice(0, 100)}` : "NOT REFUSED");
  if (!r.isError) throw new Error("the agent was not refused after revocation");
}
await client.close();

if (process.env.OUT) {
  const at = new Date().toISOString().slice(0, 16).replace("T", " ");
  const md = [
    `Run on ${NETWORK_LABEL[network].name} (chain ${CHAIN_ID}) on ${at} UTC by \`scripts/e2e/flow.mts\`. Mocked on this network: ${health.label.mocked.join(", ") || "nothing"}.`,
    "",
    `Owner \`${owner.address}\`, agent \`${agent.address}\`, mandate ${id}.`,
    "",
    "| Who | Step | Result | Transaction |",
    "|---|---|---|---|",
    ...rows.map((r) => `| ${r.who} | ${r.step} | ${r.result.replace(/\|/g, "/")} | ${r.tx} |`),
    "",
  ].join("\n");
  writeFileSync(process.env.OUT, md);
}
console.log(`\nPASS: ${rows.length} steps on chain ${CHAIN_ID}`);
