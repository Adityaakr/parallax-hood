/**
 * Binance Agentic Wallet (`baw`, npm @binance/agentic-wallet) as an execution layer for Parallax.
 *
 * The CLI holds a wallet paired with the user's Binance app (QR sign-in, 48 h sessions). Everything here goes
 * through its documented two-step contract-call flow — `preview` (Binance simulates the calldata, parses it and
 * scores its risk) then `execute` (broadcast, or "confirm in the app" for sensitive calls) — so Binance's
 * safety layer sits in front of Parallax's onchain caps. The wallet supports BSC mainnet only (no testnet), and
 * Developer Mode must be enabled in the app for contract calls.
 *
 * Nothing in this module builds calldata: it carries what the resolver produced, and it never sees a key.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Address, Hex } from "viem";

const run = promisify(execFile);

export type BawResult<T = Record<string, any>> = { success: true; data: T } | { success: false; error: { code: number | string; name: string; message: string; data?: unknown } };

export class AgenticWallet {
  constructor(private bin = process.env.BAW_BIN ?? "baw") {}

  private async call<T = Record<string, any>>(args: string[]): Promise<BawResult<T>> {
    try {
      const { stdout } = await run(this.bin, [...args, "--json"], { timeout: 120_000, maxBuffer: 4 << 20 });
      return JSON.parse(stdout) as BawResult<T>;
    } catch (e) {
      const stdout = (e as { stdout?: string }).stdout;
      if (stdout) {
        try { return JSON.parse(stdout) as BawResult<T>; } catch { /* fall through */ }
      }
      const code = (e as { code?: string }).code;
      const message = code === "ENOENT" ? "the `baw` CLI is not installed (npm install -g @binance/agentic-wallet)" : (e as Error).message;
      return { success: false, error: { code: code ?? "CLI", name: "CLI_ERROR", message } };
    }
  }

  async status() {
    const s = await this.call<{ status: string }>(["wallet", "status"]);
    return s.success ? s.data.status : `unavailable: ${s.error.message}`;
  }

  /** The wallet's address on a chain (binanceChainId "56" for BSC). */
  async address(binanceChainId = "56"): Promise<Address | null> {
    const r = await this.call<{ addresses: { binanceChainId: string; address: string }[] }>(["wallet", "address"]);
    if (!r.success) return null;
    return (r.data.addresses.find((a) => a.binanceChainId === binanceChainId)?.address as Address | undefined) ?? null;
  }

  async settings() {
    const r = await this.call<{ devMode: { enabled: boolean; expiresAt: string | null; dailyLimit: number }; dailyLimit: number; quotaLeft: number; x402DailyLimit: number; sessionExpireTime: string }>(["wallet", "settings"]);
    return r.success ? r.data : null;
  }

  /** Binance Wallet's own swap route for `qty` of `fromToken` into `toToken`; no trade is placed. */
  async quote(p: { fromToken: Address; toToken: Address; qty: string; binanceChainId?: string }) {
    return this.call<{ fromCoinSymbol: string; fromCoinAmount: string; toCoinSymbol: string; toCoinAmount: string; slippage: number }>([
      "market-order", "quote", "--fromTokenQty", p.qty, "--fromToken", p.fromToken, "--toToken", p.toToken, "--binanceChainId", p.binanceChainId ?? "56",
    ]);
  }

  /** Step 1 of an external contract call: Binance simulates and risk-scores the calldata and issues a requestId. */
  async preview(p: { from: Address; to: Address; data: Hex; value?: string; binanceChainId?: string }) {
    return this.call<{
      requestId: string; parsedTx: Record<string, unknown>; requireConfirmation: boolean; expiresAt: number;
      simulationResult: { simulationCode: string; simulationErrorDetail: string | null; balanceChanges: unknown[]; allowanceChanges: unknown[]; authorityChanges: unknown[] };
      risks: { riskDetails: { code: string; title: string; description: string; riskType: string }[]; addresses: Record<string, unknown>; riskBehaviors: unknown[] };
    }>(["contract-call", "preview", "--binanceChainId", p.binanceChainId ?? "56", "--from", p.from, "--to", p.to, "--value", p.value ?? "0", "--inputData", p.data]);
  }

  /** Step 2: broadcast a previewed call (or hand it to the app when Binance requires confirmation). */
  async execute(requestId: string) {
    return this.call<{ orderId: string; status: "BROADCASTED" | "PENDING_CONFIRMATION"; txHash: Hex | null; message: string | null }>(["contract-call", "execute", "--requestId", requestId]);
  }
}
