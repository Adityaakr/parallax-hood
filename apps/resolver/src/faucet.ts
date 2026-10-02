import { createWalletClient, encodeFunctionData, http, isAddress, parseEther, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Erc20Abi, MockUSDGAbi, ROBINHOOD_ADDRESSES, USDG_UNIT } from "@parallax-hood/sdk";
import type { Db } from "./db.js";

const TransferAbi = [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }] as const;
import type { Chain } from "./chain.js";

const USDG_GRANT = 2_000n * USDG_UNIT;
const ETH_GRANT = parseEther("1");

/** Testnet: mock USDG minted by the faucet key, plus a little test ETH for gas when the wallet is dry. */
const TESTNET_USDG_GRANT = 10_000n * USDG_UNIT;
const TESTNET_ETH_TOPUP = parseEther("0.0005");
const TESTNET_ETH_FLOOR = parseEther("0.0002");

/**
 * Test-funds faucet, only on chains we own. Local fork / mocks use anvil cheatcodes: ETH via anvil_setBalance;
 * USDG by impersonating the deepest USDG pool on the fork (the largest holder that is certain to exist there) or
 * by minting mock USDG on the mocks chain. The testnet uses a real funded key (`FAUCET_PRIVATE_KEY`) and a
 * per-address cooldown kept in SQLite. Never mounted on mainnet.
 */
export async function faucet(chain: Chain, to: string, db?: Db, usdgSource?: Address): Promise<{ address: Address; eth: string; usdg: string; txHash: Hex }> {
  if (!isAddress(to)) throw new Error("invalid address");
  const rpc = chain.client.request as (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  const network = chain.cfg.network;
  if (network === "robinhoodTestnet") return testnetFaucet(chain, to, db);
  if (network !== "fork" && network !== "mocks") throw new Error(`faucet is not available on ${network}`);
  await rpc({ method: "anvil_setBalance", params: [to, `0x${ETH_GRANT.toString(16)}`] });
  let from: Address, data: Hex;
  if (network === "fork") {
    if (!usdgSource || chain.d.usdg.toLowerCase() !== ROBINHOOD_ADDRESSES.usdg.toLowerCase()) throw new Error("no USDG pool to fund from on this fork");
    from = usdgSource;
    await rpc({ method: "anvil_setBalance", params: [from, `0x${ETH_GRANT.toString(16)}`] });
    data = encodeFunctionData({ abi: TransferAbi, functionName: "transfer", args: [to, USDG_GRANT] });
  } else {
    from = to; // MockUSDG.mint is permissionless; mint to self so the sender is the recipient
    data = encodeFunctionData({ abi: MockUSDGAbi, functionName: "mint", args: [to, USDG_GRANT] });
  }
  await rpc({ method: "anvil_impersonateAccount", params: [from] });
  try {
    const txHash = (await rpc({ method: "eth_sendTransaction", params: [{ from, to: chain.d.usdg, data, gas: "0x30000" }] })) as Hex;
    await chain.client.waitForTransactionReceipt({ hash: txHash });
    const [usdg, eth] = await Promise.all([chain.client.readContract({ address: chain.d.usdg, abi: Erc20Abi, functionName: "balanceOf", args: [to] }), chain.client.getBalance({ address: to })]);
    return { address: to, eth: eth.toString(), usdg: usdg.toString(), txHash };
  } finally {
    await rpc({ method: "anvil_stopImpersonatingAccount", params: [from] }).catch(() => {});
  }
}

async function testnetFaucet(chain: Chain, to: Address, db?: Db): Promise<{ address: Address; eth: string; usdg: string; txHash: Hex }> {
  const pk = chain.cfg.FAUCET_PRIVATE_KEY;
  if (!pk) throw new Error("faucet is not configured on this network (FAUCET_PRIVATE_KEY)");
  const key = `faucet:${to.toLowerCase()}`;
  const last = Number(db?.getKv(key) ?? 0);
  const now = Math.floor(Date.now() / 1000);
  if (now - last < chain.cfg.FAUCET_COOLDOWN_S) throw new Error(`already funded ${Math.round((now - last) / 60)} min ago; try again in ${Math.ceil((chain.cfg.FAUCET_COOLDOWN_S - (now - last)) / 60)} min`);
  const account = privateKeyToAccount(pk as Hex);
  const wallet = createWalletClient({ account, chain: chain.cfg.chain, transport: http(chain.cfg.rpcUrl) });
  // gas first, so a brand-new wallet can actually approve and mint afterwards
  if ((await chain.client.getBalance({ address: to })) < TESTNET_ETH_FLOOR) {
    const h = await wallet.sendTransaction({ to, value: TESTNET_ETH_TOPUP });
    await chain.client.waitForTransactionReceipt({ hash: h });
  }
  const txHash = await wallet.writeContract({ address: chain.d.usdg, abi: MockUSDGAbi, functionName: "mint", args: [to, TESTNET_USDG_GRANT] });
  await chain.client.waitForTransactionReceipt({ hash: txHash });
  db?.setKv(key, String(now));
  const [usdg, eth] = await Promise.all([chain.client.readContract({ address: chain.d.usdg, abi: Erc20Abi, functionName: "balanceOf", args: [to] }), chain.client.getBalance({ address: to })]);
  return { address: to, eth: eth.toString(), usdg: usdg.toString(), txHash };
}
