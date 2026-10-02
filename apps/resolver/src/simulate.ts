import { type Address, type Hex, encodeAbiParameters, keccak256, pad, toHex, numberToHex, BaseError, ContractFunctionRevertedError, decodeErrorResult } from "viem";
import { Erc20Abi, ShareRouterAbi, BasketVaultAbi, AgentMandateAbi } from "@parallax-hood/sdk";
import type { Chain } from "./chain.js";
import { logger } from "./log.js";

const log = logger("simulate");
const ALL_ABIS = [...ShareRouterAbi, ...BasketVaultAbi, ...AgentMandateAbi] as const;

export type SimResult = { ok: boolean; gasUsed?: string; error?: string; approvalNeeded: boolean; usedOverrides: boolean };

/**
 * Simulates an unsigned tx with eth_call from the user's address. If the user has not yet approved USDG (or lacks
 * balance), we retry with an eth_call state override that sets the ERC-20 balance/allowance storage slots, so the
 * route itself is still verified end to end. Slots are discovered once per token by probing (like forge's `deal`).
 */
/** Slots already known, so a simulation need not probe for them. None are recorded for Robinhood Chain yet. */
const KNOWN_SLOTS: Record<string, { balance: number; allowance: number }> = {};

export class Simulator {
  private slots = new Map<string, { balance: number; allowance: number } | null>();
  constructor(private chain: Chain) {}

  private async discoverSlots(token: Address, owner: Address, spender: Address) {
    const k = token.toLowerCase();
    if (this.slots.has(k)) return this.slots.get(k)!;
    const known = KNOWN_SLOTS[k];
    if (known) {
      this.slots.set(k, known);
      return known;
    }
    let found: { balance: number; allowance: number } | null = null;
    for (let s = 0; s < 30 && !found; s++) {
      const balSlot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [owner, BigInt(s)]));
      const probe = 123456789n;
      try {
        const bal = await this.chain.client.readContract({
          address: token, abi: Erc20Abi, functionName: "balanceOf", args: [owner],
          stateOverride: [{ address: token, stateDiff: [{ slot: balSlot, value: pad(numberToHex(probe)) }] }],
        });
        if (bal === probe) {
          // allowance slot: try nearby slots
          for (let a = 0; a < 30; a++) {
            const inner = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [owner, BigInt(a)]));
            const allowSlot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [spender, inner]));
            const al = await this.chain.client.readContract({
              address: token, abi: Erc20Abi, functionName: "allowance", args: [owner, spender],
              stateOverride: [{ address: token, stateDiff: [{ slot: allowSlot, value: pad(numberToHex(probe)) }] }],
            });
            if (al === probe) {
              found = { balance: s, allowance: a };
              break;
            }
          }
        }
      } catch (e) {
        log.debug("slot probe failed (state override unsupported?)", { err: (e as Error).message });
        break;
      }
    }
    this.slots.set(k, found);
    return found;
  }

  async simulate(p: { from: Address; to: Address; data: Hex; value?: bigint; usdgSpender?: Address; usdgAmount?: bigint }): Promise<SimResult> {
    const usdg = this.chain.d.usdg;
    let approvalNeeded = false;
    if (p.usdgSpender && p.usdgAmount) {
      const [al, bal] = await Promise.all([this.chain.allowance(usdg, p.from, p.usdgSpender), this.chain.balanceOf(usdg, p.from)]);
      approvalNeeded = al < p.usdgAmount;
      const needsBalance = bal < p.usdgAmount;
      if (approvalNeeded || needsBalance) {
        const slots = await this.discoverSlots(usdg, p.from, p.usdgSpender);
        if (!slots) return { ok: false, error: "cannot simulate without USDG approval/balance and state overrides are unsupported by this RPC", approvalNeeded, usedOverrides: false };
        const balSlot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [p.from, BigInt(slots.balance)]));
        const inner = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [p.from, BigInt(slots.allowance)]));
        const allowSlot = keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [p.usdgSpender, inner]));
        const amt = pad(numberToHex(p.usdgAmount * 2n));
        const r = await this.call(p, [{ address: usdg, stateDiff: [{ slot: balSlot, value: amt }, { slot: allowSlot, value: amt }] }]);
        return { ...r, approvalNeeded, usedOverrides: true };
      }
    }
    const r = await this.call(p, undefined);
    return { ...r, approvalNeeded, usedOverrides: false };
  }

  private async call(p: { from: Address; to: Address; data: Hex; value?: bigint }, stateOverride: any): Promise<{ ok: boolean; gasUsed?: string; error?: string }> {
    try {
      const gas = await this.chain.client.estimateGas({ account: p.from, to: p.to, data: p.data, value: p.value ?? 0n, stateOverride });
      return { ok: true, gasUsed: gas.toString() };
    } catch (e) {
      return { ok: false, error: this.explain(e) };
    }
  }

  explain(e: unknown): string {
    if (e instanceof BaseError) {
      const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | undefined;
      if (revert?.data) return `${revert.data.errorName}(${(revert.data.args ?? []).map(String).join(", ")})`;
      const ce = /custom error (0x[0-9a-fA-F]{8}):?\s*([0-9a-fA-F]*)/.exec(e.message);
      const m = ce ? [ce[0], `${ce[1]}${ce[2] ?? ""}`] : (/data:\s*(0x[0-9a-fA-F]+)/.exec(e.message) ?? /(0x[0-9a-fA-F]{8,})/.exec(e.shortMessage ?? ""));
      if (m?.[1]) {
        try {
          const d = decodeErrorResult({ abi: ALL_ABIS, data: m[1] as Hex });
          return `${d.errorName}(${(d.args ?? []).map(String).join(", ")})`;
        } catch {
          /* unknown selector */
        }
      }
      return e.shortMessage ?? e.message;
    }
    return String((e as Error)?.message ?? e);
  }
}
