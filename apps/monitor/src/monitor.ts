/**
 * Health monitor. It replaces the keeper the BNB Chain build needed.
 *
 * There, one issuer's share ratio existed only behind an API, so a keeper had to post it on chain along with
 * attestation timestamps and market state. On Robinhood Chain the ratio is each token's own `uiMultiplier()`,
 * the price is a Chainlink feed and no attestation is published, so nothing needs posting and this process
 * holds no key and sends no transaction. What is left is watching for the conditions that need a human:
 *
 *   - a feed that has stopped (older than the registry's price window, which already allows for a weekend)
 *   - a multiplier that has moved past the registry's step bound since its checkpoint: a corporate action,
 *     after which buys of that token stay paused until the admin confirms the new ratio
 *   - a multiplier change the issuer has scheduled
 *   - a token, or USDG, that its issuer has paused
 *   - pools too thin to fill an order
 *   - a vault whose backing check fails, which no code path should allow
 */
import { type Address, type PublicClient, parseAbi } from "viem";
import { StockRegistryAbi, BasketFactoryAbi, BasketVaultAbi, ChainlinkAggregatorAbi, Erc8056Abi, USDG_UNIT } from "@parallax-hood/sdk";
import { UniswapV3Client, UNISWAP_V3_DEPLOYMENTS } from "@parallax-hood/uniswap-client";
import type { MonitorConfig } from "./config.js";

export type Severity = "ok" | "notice" | "warning" | "critical";
export type Finding = { check: string; subject: string; severity: Severity; detail: string };
export type Report = { at: number; chainId: number; network: string; deployed: boolean; worst: Severity; findings: Finding[] };

const ORDER: Severity[] = ["ok", "notice", "warning", "critical"];
export const worstOf = (f: Finding[]): Severity => f.reduce<Severity>((w, x) => (ORDER.indexOf(x.severity) > ORDER.indexOf(w) ? x.severity : w), "ok");

const IssuerAbi = parseAbi(["function paused() view returns (bool)", "function oraclePaused() view returns (bool)"]);
const hours = (s: number) => `${(s / 3600).toFixed(1)}h`;

/** A feed is healthy inside the window, worth a look in its last fifth, and stopped beyond it. */
export function feedVerdict(ticker: string, ageS: number, maxAgeS: number, answer: bigint): Finding {
  if (answer <= 0n) return { check: "feed", subject: ticker, severity: "critical", detail: `feed answer is ${answer}` };
  if (ageS > maxAgeS) return { check: "feed", subject: ticker, severity: "critical", detail: `last update ${hours(ageS)} ago, past the ${hours(maxAgeS)} window: agent buys of ${ticker} are blocked` };
  if (ageS > maxAgeS * 0.8) return { check: "feed", subject: ticker, severity: "warning", detail: `last update ${hours(ageS)} ago, window is ${hours(maxAgeS)}` };
  return { check: "feed", subject: ticker, severity: "ok", detail: `updated ${hours(ageS)} ago` };
}

/** How far the live multiplier has moved from the registry's checkpoint, against the step bound. */
export function multiplierVerdict(ticker: string, checkpoint: bigint, live: bigint, maxStepBps: number): Finding {
  if (live === 0n) return { check: "multiplier", subject: ticker, severity: "critical", detail: "token reports a zero multiplier" };
  if (checkpoint === 0n) return { check: "multiplier", subject: ticker, severity: "ok", detail: `multiplier ${Number(live) / 1e18}` };
  const diff = live > checkpoint ? live - checkpoint : checkpoint - live;
  const stepBps = Number((diff * 10_000n) / checkpoint);
  if (stepBps > maxStepBps) return { check: "multiplier", subject: ticker, severity: "critical", detail: `multiplier moved ${stepBps} bps from the checkpoint, past the ${maxStepBps} bps bound: buys are paused until the admin confirms the new ratio (confirmRatio)` };
  if (stepBps > maxStepBps / 2) return { check: "multiplier", subject: ticker, severity: "warning", detail: `multiplier is ${stepBps} bps from the checkpoint, bound is ${maxStepBps} bps: checkpoint it (checkpointRatio) before it drifts further` };
  return { check: "multiplier", subject: ticker, severity: "ok", detail: `${stepBps} bps from the checkpoint` };
}

export function scheduledVerdict(ticker: string, current: bigint, next: bigint, effectiveAt: number, now: number): Finding | null {
  if (next === current || effectiveAt <= now) return null;
  return { check: "scheduled-multiplier", subject: ticker, severity: "notice", detail: `multiplier changes from ${Number(current) / 1e18} to ${Number(next) / 1e18} at ${new Date(effectiveAt * 1000).toISOString()}` };
}

export function depthVerdict(ticker: string, usdg: bigint, minUsdg: number): Finding {
  const have = Number(usdg / USDG_UNIT);
  return have < minUsdg
    ? { check: "depth", subject: ticker, severity: "warning", detail: `direct pools hold ${have.toLocaleString("en-US")} USDG, under ${minUsdg.toLocaleString("en-US")}` }
    : { check: "depth", subject: ticker, severity: "ok", detail: `direct pools hold ${have.toLocaleString("en-US")} USDG` };
}

export class Monitor {
  private readonly uniswap: UniswapV3Client | null;
  constructor(private cfg: MonitorConfig, private client: PublicClient) {
    const deployment = UNISWAP_V3_DEPLOYMENTS[cfg.chain.id];
    this.uniswap = deployment && !cfg.deployment?.venue ? new UniswapV3Client({ client, deployment }) : null;
  }

  private async tryRead<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch {
      return null;
    }
  }

  async run(): Promise<Report> {
    const findings: Finding[] = [];
    const now = Number((await this.client.getBlock()).timestamp);
    const reg = this.cfg.deployment ? ({ address: this.cfg.deployment.registry, abi: StockRegistryAbi } as const) : null;

    let maxPriceAge = this.cfg.DEFAULT_MAX_PRICE_AGE_S;
    let maxStepBps = 500;
    if (reg) {
      const [age, step, paused] = await Promise.all([
        this.client.readContract({ ...reg, functionName: "maxPriceAge" }),
        this.client.readContract({ ...reg, functionName: "maxRatioStepBps" }),
        this.client.readContract({ ...reg, functionName: "buysPaused" }),
      ]);
      maxPriceAge = Number(age);
      maxStepBps = Number(step);
      if (paused) findings.push({ check: "registry", subject: "buys", severity: "warning", detail: "the guardian has paused buys; sells and in-kind redemption are unaffected" });
    }

    const usdgPaused = await this.tryRead(() => this.client.readContract({ address: this.cfg.usdg, abi: IssuerAbi, functionName: "paused" }));
    if (usdgPaused) findings.push({ check: "issuer-pause", subject: "USDG", severity: "critical", detail: "USDG is paused by its issuer: no transfer or approval goes through" });

    for (const s of this.cfg.universe) {
      const [live, next, eff, paused, oraclePaused] = await Promise.all([
        this.tryRead(() => this.client.readContract({ address: s.token, abi: Erc8056Abi, functionName: "uiMultiplier" })),
        this.tryRead(() => this.client.readContract({ address: s.token, abi: Erc8056Abi, functionName: "newUIMultiplier" })),
        this.tryRead(() => this.client.readContract({ address: s.token, abi: Erc8056Abi, functionName: "effectiveAt" })),
        this.tryRead(() => this.client.readContract({ address: s.token, abi: IssuerAbi, functionName: "paused" })),
        this.tryRead(() => this.client.readContract({ address: s.token, abi: IssuerAbi, functionName: "oraclePaused" })),
      ]);
      if (live === null) {
        findings.push({ check: "multiplier", subject: s.ticker, severity: "critical", detail: `${s.token} did not answer uiMultiplier()` });
        continue;
      }
      const checkpoint = reg ? ((await this.tryRead(() => this.client.readContract({ ...reg, functionName: "postedRatio", args: [s.token] })))?.ratio ?? 0n) : 0n;
      findings.push(multiplierVerdict(s.ticker, checkpoint, live, maxStepBps));
      if (next !== null && eff !== null) {
        const sched = scheduledVerdict(s.ticker, live, next, Number(eff), now);
        if (sched) findings.push(sched);
      }
      if (paused) findings.push({ check: "issuer-pause", subject: s.ticker, severity: "critical", detail: "token is paused by its issuer: it cannot be bought, sold or redeemed in kind until that is lifted" });
      if (oraclePaused) findings.push({ check: "issuer-pause", subject: s.ticker, severity: "warning", detail: "the issuer has flagged the token's price as paused (a corporate action is being applied)" });

      if (s.feed) {
        const round = await this.tryRead(() => this.client.readContract({ address: s.feed!, abi: ChainlinkAggregatorAbi, functionName: "latestRoundData" }));
        findings.push(round ? feedVerdict(s.ticker, now - Number(round[3]), maxPriceAge, round[1]) : { check: "feed", subject: s.ticker, severity: "critical", detail: `${s.feed} did not answer latestRoundData()` });
      }
      if (this.uniswap) {
        const depth = await this.tryRead(() => this.uniswap!.depth(this.cfg.usdg, s.token));
        if (depth) findings.push(depthVerdict(s.ticker, depth.balance, this.cfg.MIN_POOL_USDG));
      }
    }

    if (this.cfg.deployment) {
      const baskets = (await this.tryRead(() => this.client.readContract({ address: this.cfg.deployment!.factory, abi: BasketFactoryAbi, functionName: "baskets" }))) ?? [];
      for (const b of baskets as Address[]) {
        const [symbol, ok] = await Promise.all([
          this.client.readContract({ address: b, abi: BasketVaultAbi, functionName: "symbol" }),
          this.client.readContract({ address: b, abi: BasketVaultAbi, functionName: "backingOk" }),
        ]);
        findings.push(ok
          ? { check: "backing", subject: symbol, severity: "ok", detail: "held shares cover every constituent" }
          : { check: "backing", subject: symbol, severity: "critical", detail: "held shares are below what the supply requires: a multiplier fell or the issuer burned from the vault" });
      }
    }
    return { at: now, chainId: this.cfg.CHAIN_ID, network: this.cfg.chain.name, deployed: Boolean(this.cfg.deployment), worst: worstOf(findings), findings };
  }
}
