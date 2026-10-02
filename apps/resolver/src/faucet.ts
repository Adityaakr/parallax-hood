import { createWalletClient, encodeFunctionData, http, isAddress, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Erc20Abi, MockUSDTAbi } from "@parallax-hood/sdk";
import type { Db } from "./db.js";

const TransferAbi = [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }] as const;
import type { Chain } from "./chain.js";

/** Binance hot wallet on BSC: large USDT balance, impersonated on the fork to hand out test USDT. */
const WHALE: Address = "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3";
const USDT_GRANT = 2_000n * 10n ** 18n;
const BNB_GRANT = parseEther("1");

/** BSC testnet: mock USDT minted by the faucet key, plus a little tBNB for gas when the wallet is dry. */
const TESTNET_USDT_GRANT = 10_000n * 10n ** 18n;
const TESTNET_BNB_TOPUP = parseEther("0.005");
const TESTNET_BNB_FLOOR = parseEther("0.002");

/**
 * Test-funds faucet, only on chains we own. Local fork / mocks use anvil cheatcodes: BNB via anvil_setBalance;
 * USDT by impersonating a mainnet whale (fork) or minting mock USDT (mocks). BSC testnet uses a real funded key
 * (`FAUCET_PRIVATE_KEY`) and a per-address cooldown kept in SQLite. Never mounted on mainnet.
 */
export async function faucet(chain: Chain, to: string, db?: Db): Promise<{ address: Address; bnb: string; usdt: string; txHash: Hex }> {
  if (!isAddress(to)) throw new Error("invalid address");
  const rpc = chain.client.request as (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  const network = chain.cfg.network;
  if (network === "bscTestnet") return testnetFaucet(chain, to, db);
  if (network !== "fork" && network !== "mocks") throw new Error(`faucet is not available on ${network}`);
  await rpc({ method: "anvil_setBalance", params: [to, `0x${BNB_GRANT.toString(16)}`] });
  let from: Address, data: Hex;
  if (network === "fork") {
    from = WHALE;
    await rpc({ method: "anvil_setBalance", params: [WHALE, `0x${BNB_GRANT.toString(16)}`] });
    data = encodeFunctionData({ abi: TransferAbi, functionName: "transfer", args: [to, USDT_GRANT] });
  } else {
    from = to; // MockUSDT.mint is permissionless; mint to self so the sender is the recipient
    data = encodeFunctionData({ abi: MockUSDTAbi, functionName: "mint", args: [to, USDT_GRANT] });
  }
  await rpc({ method: "anvil_impersonateAccount", params: [from] });
  try {
    const txHash = (await rpc({ method: "eth_sendTransaction", params: [{ from, to: chain.d.usdt, data, gas: "0x30000" }] })) as Hex;
    await chain.client.waitForTransactionReceipt({ hash: txHash });
    const [usdt, bnb] = await Promise.all([chain.client.readContract({ address: chain.d.usdt, abi: Erc20Abi, functionName: "balanceOf", args: [to] }), chain.client.getBalance({ address: to })]);
    return { address: to, bnb: bnb.toString(), usdt: usdt.toString(), txHash };
  } finally {
    await rpc({ method: "anvil_stopImpersonatingAccount", params: [from] }).catch(() => {});
  }
}

async function testnetFaucet(chain: Chain, to: Address, db?: Db): Promise<{ address: Address; bnb: string; usdt: string; txHash: Hex }> {
  const pk = chain.cfg.FAUCET_PRIVATE_KEY;
  if (!pk) throw new Error("faucet is not configured on this network (FAUCET_PRIVATE_KEY)");
  const key = `faucet:${to.toLowerCase()}`;
  const last = Number(db?.getKv(key) ?? 0);
  const now = Math.floor(Date.now() / 1000);
  if (now - last < chain.cfg.FAUCET_COOLDOWN_S) throw new Error(`already funded ${Math.round((now - last) / 60)} min ago; try again in ${Math.ceil((chain.cfg.FAUCET_COOLDOWN_S - (now - last)) / 60)} min`);
  const account = privateKeyToAccount(pk as Hex);
  const wallet = createWalletClient({ account, chain: chain.cfg.chain, transport: http(chain.cfg.rpcUrl) });
  // gas first, so a brand-new wallet can actually approve and mint afterwards
  if ((await chain.client.getBalance({ address: to })) < TESTNET_BNB_FLOOR) {
    const h = await wallet.sendTransaction({ to, value: TESTNET_BNB_TOPUP });
    await chain.client.waitForTransactionReceipt({ hash: h });
  }
  const txHash = await wallet.writeContract({ address: chain.d.usdt, abi: MockUSDTAbi, functionName: "mint", args: [to, TESTNET_USDT_GRANT] });
  await chain.client.waitForTransactionReceipt({ hash: txHash });
  db?.setKv(key, String(now));
  const [usdt, bnb] = await Promise.all([chain.client.readContract({ address: chain.d.usdt, abi: Erc20Abi, functionName: "balanceOf", args: [to] }), chain.client.getBalance({ address: to })]);
  return { address: to, bnb: bnb.toString(), usdt: usdt.toString(), txHash };
}
