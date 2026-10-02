import { createPublicClient, createWalletClient, http, type Address, type Hex, type PublicClient, type WalletClient, type Account, encodeFunctionData, decodeErrorResult } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";
import { StockRegistryAbi, Erc8056Abi, AgentMandateAbi, BasketVaultAbi, MockSwapTargetAbi, MockStockTokenAbi, idToTicker, tickerToId, parseWad, stepBps, formatWad } from "@parallax-hood/sdk";
import { BinanceWeb3Client, FixtureMissingError } from "@parallax-hood/binance-client";
import type { Config } from "./config.js";

type Log = { info: (m: string, x?: Record<string, unknown>) => void; warn: (m: string, x?: Record<string, unknown>) => void; error: (m: string, x?: Record<string, unknown>) => void };
const mkLog = (scope: string): Log => {
  const emit = (level: string, msg: string, extra?: Record<string, unknown>) =>
    (level === "info" ? console.log : console.error)(JSON.stringify({ ts: new Date().toISOString(), level, scope, msg, ...(extra ?? {}) }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  return { info: (m, x) => emit("info", m, x), warn: (m, x) => emit("warn", m, x), error: (m, x) => emit("error", m, x) };
};

export type Intent = { kind: string; to: Address; data: Hex; note: string };

export type KeeperState = {
  lastRun: Record<string, { at: number; ok: boolean; note?: string }>;
  intents: Intent[]; // dry-run log (last 200)
  sent: Array<{ kind: string; hash: Hex; note: string; at: number; gas?: string; costWei?: string }>;
  alerts: Array<{ at: number; msg: string; data?: unknown }>;
  /** What this keeper has actually spent, and what it refused to spend. Measured from receipts, never estimated. */
  spend: { txs: number; wei: bigint; since: number; skipped: number };
};

/**
 * Keeper: posts ratios / attestations / market state to the registry and runs the permissionless migration bot.
 * Everything it posts is bounded onchain (step limits, monotone attestations); it holds no user funds and has no
 * special power over baskets. `dryRun` logs intents instead of sending.
 */
export class Keeper {
  readonly log = mkLog("keeper");
  readonly pub: PublicClient;
  readonly wallet: WalletClient | undefined;
  readonly account: Account | undefined;
  readonly binance: BinanceWeb3Client;
  readonly state: KeeperState = { lastRun: {}, intents: [], sent: [], alerts: [], spend: { txs: 0, wei: 0n, since: Date.now(), skipped: 0 } };
  private timers: NodeJS.Timeout[] = [];

  /** Mainnet reads for the hybrid demo (live ERC-8056 multipliers of the twins). */
  readonly mainnet: PublicClient;

  constructor(readonly cfg: Config, readonly dryRun = cfg.KEEPER_DRY_RUN) {
    this.pub = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl) });
    this.mainnet = cfg.network === "bsc" ? this.pub : createPublicClient({ chain: bsc, transport: http(cfg.BSC_RPC_URL) });
    const pk = cfg.KEEPER_PRIVATE_KEY;
    if (!pk && !dryRun) throw new Error("KEEPER_PRIVATE_KEY is required unless --dry-run");
    this.account = pk ? privateKeyToAccount(pk as Hex) : undefined;
    this.wallet = this.account ? createWalletClient({ account: this.account, chain: cfg.chain, transport: http(cfg.rpcUrl) }) : undefined;
    this.binance = new BinanceWeb3Client({ apiKey: cfg.BINANCE_WEB3_API_KEY, apiSecret: cfg.BINANCE_WEB3_API_SECRET, mode: cfg.BINANCE_CLIENT_MODE, fixturesDir: cfg.FIXTURES_DIR, logger: { info: () => {}, warn: (m) => this.log.warn(String(m)) } });
  }

  get registry() {
    return { address: this.cfg.deployment.registry, abi: StockRegistryAbi } as const;
  }

  /** The token the Binance catalogue knows for `token`: its mainnet twin on a hybrid network, else itself. */
  twin(token: Address): Address {
    return this.cfg.twins.get(token.toLowerCase())?.token ?? token;
  }

  private alert(msg: string, data?: unknown) {
    this.state.alerts.push({ at: Date.now(), msg, data });
    if (this.state.alerts.length > 200) this.state.alerts.shift();
    this.log.warn(`ALERT ${msg}`, { data });
  }

  /** Send (or record) a transaction. Simulates first; a revert is reported, never retried blindly. */
  async submit(intent: Intent): Promise<Hex | null> {
    this.state.intents.push(intent);
    if (this.state.intents.length > 200) this.state.intents.shift();
    if (this.dryRun || !this.wallet || !this.account) {
      this.log.info("dry-run intent", { kind: intent.kind, to: intent.to, note: intent.note, data: intent.data.slice(0, 10) });
      return null;
    }
    const stop = await this.budgetStop();
    if (stop) {
      this.state.spend.skipped++;
      this.alert(`${intent.kind} not sent: ${stop}`, { note: intent.note });
      return null;
    }
    try {
      await this.pub.call({ account: this.account, to: intent.to, data: intent.data });
    } catch (e) {
      this.alert(`${intent.kind} would revert: ${this.explain(e)}`, { note: intent.note });
      return null;
    }
    const hash = await this.wallet.sendTransaction({ account: this.account, chain: this.cfg.chain, to: intent.to, data: intent.data });
    const rcpt = await this.pub.waitForTransactionReceipt({ hash });
    const cost = rcpt.gasUsed * (rcpt.effectiveGasPrice ?? 0n);
    this.state.spend.txs++;
    this.state.spend.wei += cost;
    this.state.sent.push({ kind: intent.kind, hash, note: intent.note, at: Date.now(), gas: rcpt.gasUsed.toString(), costWei: cost.toString() });
    if (this.state.sent.length > 200) this.state.sent.shift();
    this.log.info("sent", { kind: intent.kind, hash, status: rcpt.status, gas: rcpt.gasUsed, costWei: cost.toString(), note: intent.note });
    return hash;
  }

  explain(e: unknown): string {
    const msg = String((e as Error)?.message ?? e);
    const m = /custom error (0x[0-9a-fA-F]{8}):?\s*([0-9a-fA-F]*)/.exec(msg) ?? /data:\s*(0x[0-9a-fA-F]{8})([0-9a-fA-F]*)/.exec(msg);
    if (m) {
      try {
        const d = decodeErrorResult({ abi: [...StockRegistryAbi, ...BasketVaultAbi], data: `${m[1]}${m[2] ?? ""}` as Hex });
        return `${d.errorName}(${(d.args ?? []).map(String).join(", ")})`;
      } catch {
        /* unknown */
      }
    }
    return msg.split("\n")[0]!.slice(0, 200);
  }

  // ------------------------------------------------------------------
  // Budget
  // ------------------------------------------------------------------

  /**
   * Why this keeper should not send right now, or null. Two guards: the wallet's own balance, so a keeper can
   * never spend itself down to where it cannot post the attestation that unblocks buys, and a rolling daily
   * transaction cap, so a job that re-posts in a loop costs one day of gas rather than the whole wallet.
   */
  async budgetStop(): Promise<string | null> {
    const day = 86_400_000;
    if (Date.now() - this.state.spend.since > day) this.state.spend = { txs: 0, wei: 0n, since: Date.now(), skipped: 0 };
    if (!this.account) return this.state.spend.txs >= this.cfg.KEEPER_MAX_TX_PER_DAY ? `daily cap reached (${this.cfg.KEEPER_MAX_TX_PER_DAY} txs)` : null;
    const balance = await this.pub.getBalance({ address: this.account.address });
    const stop = budgetVerdict({
      balanceWei: balance,
      floorWei: BigInt(Math.round(this.cfg.KEEPER_MIN_BALANCE_BNB * 1e18)),
      txsToday: this.state.spend.txs,
      capPerDay: this.cfg.KEEPER_MAX_TX_PER_DAY,
    });
    return stop ? `${stop} — fund ${this.account.address}` : null;
  }

  // ------------------------------------------------------------------
  // Registry reads
  // ------------------------------------------------------------------

  /** The registry's own freshness and step bounds — every refresh is timed off these, not off the poll interval. */
  async limits() {
    const [attestation, ratio, price, ratioStep, priceStep] = await Promise.all([
      this.pub.readContract({ ...this.registry, functionName: "maxAttestationAge" }),
      this.pub.readContract({ ...this.registry, functionName: "maxRatioAge" }),
      this.pub.readContract({ ...this.registry, functionName: "maxPriceAge" }),
      this.pub.readContract({ ...this.registry, functionName: "maxRatioStepBps" }),
      this.pub.readContract({ ...this.registry, functionName: "maxPriceStepBps" }),
    ]);
    return { attestationAge: Number(attestation), ratioAge: Number(ratio), priceAge: Number(price), ratioStepBps: Number(ratioStep), priceStepBps: Number(priceStep) };
  }

  /**
   * The underlyings this keeper is responsible for. Under the default "baskets" scope that is what the deployed
   * vaults hold: a registry entry no vault references is still quotable, still sellable, and costs gas to keep
   * warm for nobody. Falls back to the whole registry when no vault is deployed.
   */
  async scope(): Promise<Set<string>> {
    const ids = await this.pub.readContract({ ...this.registry, functionName: "underlyingIds" });
    if (this.cfg.KEEPER_SCOPE === "registry") return new Set(ids.map((i) => i.toLowerCase()));
    const baskets = Object.values(this.cfg.deployment.baskets ?? {});
    const held = new Set<string>();
    for (const basket of baskets) {
      try {
        const comp = await this.pub.readContract({ address: basket as Address, abi: BasketVaultAbi, functionName: "composition" });
        for (const c of comp) held.add(c.underlyingId.toLowerCase());
      } catch (e) {
        this.log.warn("composition read failed", { basket, err: (e as Error).message });
      }
    }
    return held.size ? held : new Set(ids.map((i) => i.toLowerCase()));
  }

  async representations(only?: Set<string>) {
    const all = await this.pub.readContract({ ...this.registry, functionName: "underlyingIds" });
    const ids = only ? all.filter((i) => only.has(i.toLowerCase())) : all;
    const out: Array<{ token: Address; ticker: string; platform: string; source: "KEEPER" | "ERC8056"; posted: { ratio: bigint; updatedAt: number } }> = [];
    for (const id of ids) {
      const reps = await this.pub.readContract({ ...this.registry, functionName: "representationsOf", args: [id] });
      for (const token of reps) {
        const r = await this.pub.readContract({ ...this.registry, functionName: "getRepresentation", args: [token] });
        const p = await this.pub.readContract({ ...this.registry, functionName: "postedRatio", args: [token] });
        out.push({ token, ticker: idToTicker(id), platform: idToTicker(r.platformId), source: r.ratioSource === 1 ? "ERC8056" : "KEEPER", posted: { ratio: p.ratio, updatedAt: Number(p.updatedAt) } });
      }
    }
    return out;
  }

  private needsCache: { at: number; ids: Set<string> } | null = null;

  /**
   * The underlyings a live mandate can actually reach: what each active, unexpired mandate allows, plus every
   * constituent of a basket it allows. Nothing else needs a posted reference price — `AgentMandate` is the only
   * contract that reads one, as the floor it holds an agent's execution to — so a price posted for an underlying
   * no mandate can touch is gas spent on nobody. A mandate created since the last pass is picked up on the next
   * one, within the price job's interval.
   */
  async mandateNeeds(): Promise<Set<string>> {
    if (this.needsCache && Date.now() - this.needsCache.at < 60_000) return this.needsCache.ids;
    const address = this.cfg.deployment.mandate;
    const out = new Set<string>();
    if (address) {
      const mandate = { address, abi: AgentMandateAbi } as const;
      const [next, ids] = await Promise.all([
        this.pub.readContract({ ...mandate, functionName: "nextId" }),
        this.pub.readContract({ ...this.registry, functionName: "underlyingIds" }),
      ]);
      const baskets = Object.values(this.cfg.deployment.baskets ?? {}) as Address[];
      const now = BigInt(Math.floor(Date.now() / 1000));
      for (let id = 1n; id < next; id++) {
        const m = await this.pub.readContract({ ...mandate, functionName: "getMandate", args: [id] });
        if (!m.active || m.expiry <= now) continue;
        for (const uid of ids) {
          if (await this.pub.readContract({ ...mandate, functionName: "allowedUnderlying", args: [id, uid] })) out.add(uid.toLowerCase());
        }
        for (const basket of baskets) {
          if (!(await this.pub.readContract({ ...mandate, functionName: "allowedBasket", args: [id, basket] }))) continue;
          const comp = await this.pub.readContract({ address: basket, abi: BasketVaultAbi, functionName: "composition" });
          for (const c of comp) out.add(c.underlyingId.toLowerCase());
        }
      }
    }
    this.needsCache = { at: Date.now(), ids: out };
    return out;
  }

  /**
   * What is about to expire. Everything the registry gates a buy on has an age and a window; this reports both,
   * per platform and per representation, so a keeper run — or a human — can act before the cliff rather than
   * after it. Ages come from the chain; nothing here is estimated.
   */
  async freshness() {
    const [scope, lim] = await Promise.all([this.scope(), this.limits()]);
    const reps = await this.representations(scope);
    const now = Math.floor(Date.now() / 1000);
    const platforms = new Map<string, { attestedAt: number; ageSec: number; windowSec: number; expiresInSec: number }>();
    for (const platform of new Set(reps.map((r) => r.platform))) {
      const at = Number(await this.pub.readContract({ ...this.registry, functionName: "attestedAt", args: [tickerToId(platform)] }));
      platforms.set(platform, { attestedAt: at, ageSec: at ? now - at : -1, windowSec: lim.attestationAge, expiresInSec: at ? at + lim.attestationAge - now : -1 });
    }
    const ratios = reps
      .filter((r) => r.source === "KEEPER")
      .map((r) => ({ token: r.token, ticker: r.ticker, platform: r.platform, updatedAt: r.posted.updatedAt, ageSec: r.posted.updatedAt ? now - r.posted.updatedAt : -1, windowSec: lim.ratioAge, expiresInSec: r.posted.updatedAt ? r.posted.updatedAt + lim.ratioAge - now : -1 }));
    const blocking = [...platforms.entries()].filter(([, v]) => v.expiresInSec <= 0).map(([k]) => `${k} attestation`).concat(ratios.filter((r) => r.expiresInSec <= 0).map((r) => `${r.ticker}@${r.platform} ratio`));
    return { scope: this.cfg.KEEPER_SCOPE, underlyings: scope.size, limits: lim, platforms: Object.fromEntries(platforms), ratios, blocking };
  }

  /** A registry post costs ~34k gas on BSC (measured); rounded up so a projection never flatters itself. */
  static readonly POST_GAS = 40_000n;

  /**
   * What keeping this deployment alive costs per day once nothing is stale: every ratio refreshed at half the
   * registry's window, one attestation per platform per day, market state only where it is read, and prices only
   * for what a live mandate can reach. Drift-driven price posts are counted at one per underlying per pass,
   * which is the worst case, and called out as such.
   */
  async steadyState(gasPrice: bigint) {
    const [fresh, needs] = await Promise.all([this.freshness(), this.mandateNeeds()]);
    const keeperRatios = fresh.ratios.length;
    const ratioPosts = fresh.limits.ratioAge > 0 ? Math.ceil((keeperRatios * 86_400) / (fresh.limits.ratioAge / 2)) : 0;
    const attestationPosts = Object.keys(fresh.platforms).length;
    const marketPosts = this.cfg.postMarketState ? fresh.underlyings * 2 : 0;
    const pricePosts = needs.size * Math.ceil(86_400_000 / this.cfg.PRICE_INTERVAL_MS);
    const txs = ratioPosts + attestationPosts + marketPosts + pricePosts;
    return {
      txsPerDay: txs,
      ratioPosts, attestationPosts, marketPosts,
      pricePosts: needs.size ? `${pricePosts} worst case (${needs.size} underlying(s) a live mandate can reach, drift-driven)` : 0,
      costWeiPerDay: BigInt(txs) * Keeper.POST_GAS * gasPrice,
    };
  }

  /**
   * A dry run costed: what one full pass would send right now, and what that costs at the current gas price.
   * Every figure is measured — the gas from `eth_estimateGas` against the real state, the price from the node,
   * the balance from the account — so "N days of runway" is arithmetic on facts, not a guess.
   */
  async plan(runsPerDay: number) {
    const before = this.state.intents.length;
    await this.runAllOnce();
    const intents = this.state.intents.slice(before);
    const gasPrice = await this.pub.getGasPrice();
    const byKind = new Map<string, { count: number; gas: bigint; notes: string[] }>();
    for (const i of intents) {
      let gas = 0n;
      if (this.account) {
        try {
          gas = await this.pub.estimateGas({ account: this.account, to: i.to, data: i.data });
        } catch {
          gas = 40_000n; // a post the chain would reject; counted at a typical post's cost so the total stays honest
        }
      }
      const e = byKind.get(i.kind) ?? { count: 0, gas: 0n, notes: [] };
      e.count++;
      e.gas += gas;
      if (e.notes.length < 3) e.notes.push(i.note);
      byKind.set(i.kind, e);
    }
    const gas = [...byKind.values()].reduce((a, e) => a + e.gas, 0n);
    const steady = await this.steadyState(gasPrice);
    const costWei = gas * gasPrice;
    const balance = this.account ? await this.pub.getBalance({ address: this.account.address }) : 0n;
    return {
      account: this.account?.address ?? null,
      gasPriceWei: gasPrice.toString(),
      balanceBnb: formatWad(balance, 8),
      pass: { txs: intents.length, gas: gas.toString(), costBnb: formatWad(costWei, 8) },
      perDay: { runs: runsPerDay, costBnb: formatWad(costWei * BigInt(runsPerDay), 8) },
      steadyState: { ...steady, runwayDays: steady.costWeiPerDay > 0n ? Number((balance * 100n) / steady.costWeiPerDay) / 100 : null, costBnbPerDay: formatWad(steady.costWeiPerDay, 8), costWeiPerDay: undefined },
      byKind: Object.fromEntries([...byKind].map(([k, v]) => [k, { count: v.count, gas: v.gas.toString(), costBnb: formatWad(v.gas * gasPrice, 8), examples: v.notes }])),
    };
  }

  // ------------------------------------------------------------------
  // Jobs
  // ------------------------------------------------------------------

  /** Ratios: keeper-sourced tokens get the Binance `tokenToShareRatio`; ERC-8056 tokens get a checkpoint when drifted. */
  async jobRatios() {
    const [scope, lim] = await Promise.all([this.scope(), this.limits()]);
    const reps = await this.representations(scope);
    const maxStep = lim.ratioStepBps;
    const now = Math.floor(Date.now() / 1000);
    // refresh at half the registry's own max age: early enough that a missed run cannot age a ratio out, late
    // enough that an unchanged ratio is posted twice a day rather than every poll
    let tokens: Map<string, { tokenToShareRatio: string | null }> | null = null;
    try {
      const list = await this.binance.rwaTokens({ binanceChainId: "56" });
      tokens = new Map(list.map((t) => [t.tokenContractAddress.toLowerCase(), { tokenToShareRatio: t.tokenToShareRatio ?? null }]));
    } catch (e) {
      if (!(e instanceof FixtureMissingError)) this.log.warn("binance rwa/tokens unavailable", { err: (e as Error).message });
    }
    let posted = 0, skipped = 0;
    for (const r of reps) {
      if (r.source === "KEEPER") {
        const info = tokens?.get(this.twin(r.token).toLowerCase());
        if (!info?.tokenToShareRatio) {
          skipped++;
          continue; // no source -> do not invent; the registry ratio simply ages out and buys pause
        }
        const ratio = parseWad(info.tokenToShareRatio);
        const step = Number(stepBps(r.posted.ratio, ratio));
        if (step > maxStep) {
          this.alert(`ratio step ${step} bps > ${maxStep} for ${r.ticker}@${r.platform}; needs ADMIN confirmRatio`, { token: r.token, posted: r.posted.ratio, proposed: ratio });
          continue;
        }
        const age = now - r.posted.updatedAt;
        const why = ratioNeedsPost({ posted: r.posted.ratio, live: ratio, ageSec: age, windowSec: lim.ratioAge, minMoveBps: this.cfg.RATIO_POST_MIN_BPS });
        if (!why) continue;
        if (age > lim.ratioAge) this.alert(`${r.ticker}@${r.platform} ratio was ${Math.round(age / 3600)}h old (window ${Math.round(lim.ratioAge / 3600)}h): buys were blocked until this post`, { token: r.token });
        await this.submit({ kind: "postRatio", to: this.registry.address, data: encodeFunctionData({ ...this.registry, functionName: "postRatio", args: [r.token, ratio] }), note: `${r.ticker}@${r.platform} ratio ${formatWad(ratio, 6)} (binance tokenToShareRatio; ${why})` });
        posted++;
      } else {
        const live = await this.pub.readContract({ address: r.token, abi: Erc8056Abi, functionName: "uiMultiplier" });
        const drift = Number(stepBps(r.posted.ratio, live));
        if (drift > maxStep) {
          this.alert(`ERC-8056 multiplier for ${r.ticker}@${r.platform} moved ${drift} bps (corporate action?); buys paused until ADMIN confirmRatio`, { token: r.token, checkpoint: r.posted.ratio, live });
        } else if (drift >= this.cfg.CHECKPOINT_DRIFT_BPS) {
          await this.submit({ kind: "checkpointRatio", to: this.registry.address, data: encodeFunctionData({ ...this.registry, functionName: "checkpointRatio", args: [r.token] }), note: `${r.ticker}@${r.platform} checkpoint ${formatWad(live, 6)} (drift ${drift} bps)` });
          posted++;
        }
      }
    }
    this.state.lastRun.ratios = { at: Date.now(), ok: true, note: `${posted} posted, ${skipped} skipped (no source)` };
  }

  /**
   * Reference prices for the AgentMandate execution floor, and only for the underlyings a live mandate can reach
   * (see `mandateNeeds`). Underlyings with a Chainlink feed are skipped (the registry reads the feed directly);
   * the rest get Binance's `referencePrice` for the underlying, falling back to a representation's
   * `tokenPrice / tokenToShareRatio`. Posted when missing, drifted by PRICE_DRIFT_BPS or older than half the
   * registry's maxPriceAge. A step beyond the registry's bound is alerted, not forced.
   */
  async jobPrices() {
    const [scope, needs] = await Promise.all([this.scope(), this.mandateNeeds()]);
    const [all, maxAge, maxStep] = await Promise.all([
      this.pub.readContract({ ...this.registry, functionName: "underlyingIds" }),
      this.pub.readContract({ ...this.registry, functionName: "maxPriceAge" }),
      this.pub.readContract({ ...this.registry, functionName: "maxPriceStepBps" }),
    ]);
    const ids = all.filter((i) => scope.has(i.toLowerCase()) && needs.has(i.toLowerCase()));
    const idle = all.length - ids.length;
    let live: Map<string, { referencePrice?: string | null; tokenPrice?: string | null; tokenToShareRatio?: string | null }> | null = null;
    try {
      const list = await this.binance.rwaTokens({ binanceChainId: "56" });
      live = new Map(list.map((t) => [t.tokenContractAddress.toLowerCase(), t]));
    } catch (e) {
      if (!(e instanceof FixtureMissingError)) this.log.warn("binance rwa/tokens unavailable", { err: (e as Error).message });
    }
    let posted = 0, feeds = 0, fresh = 0, missing = 0;
    for (const id of ids) {
      if ((await this.pub.readContract({ ...this.registry, functionName: "priceFeedOf", args: [id] })) !== "0x0000000000000000000000000000000000000000") { feeds++; continue; }
      const reps = await this.pub.readContract({ ...this.registry, functionName: "representationsOf", args: [id] });
      let price: bigint | null = null;
      for (const token of reps) {
        const t = live?.get(this.twin(token).toLowerCase());
        if (!t) continue;
        if (t.referencePrice) { price = parseWad(t.referencePrice); break; }
        if (t.tokenPrice && t.tokenToShareRatio) { price = (parseWad(t.tokenPrice) * 10n ** 18n) / parseWad(t.tokenToShareRatio); break; }
      }
      if (!price) { missing++; continue; } // no source -> the posted price ages out and mandate buys pause
      const ticker = idToTicker(id);
      const [current, updatedAt] = await this.pub.readContract({ ...this.registry, functionName: "referencePrice", args: [id] });
      const age = Date.now() / 1000 - Number(updatedAt);
      if (current !== 0n && Number(stepBps(current, price)) < this.cfg.PRICE_DRIFT_BPS && age < Number(maxAge) / 2) { fresh++; continue; }
      if (current !== 0n && Number(stepBps(current, price)) > Number(maxStep)) {
        this.alert(`reference price step ${stepBps(current, price)} bps > ${maxStep} for ${ticker}; needs a manual look`, { current, proposed: price });
        continue;
      }
      await this.submit({ kind: "postReferencePrice", to: this.registry.address, data: encodeFunctionData({ ...this.registry, functionName: "postReferencePrice", args: [id, price] }), note: `${ticker} reference ${formatWad(price, 4)} USD/share (binance referencePrice)` });
      posted++;
    }
    this.state.lastRun.prices = { at: Date.now(), ok: true, note: `${posted} posted, ${fresh} fresh, ${feeds} on chainlink feeds, ${missing} without a source, ${idle} not reachable by any live mandate` };
  }

  /** Attestations: per platform, the newest daily attestation date from the Binance underlying-profile. */
  async jobAttestations() {
    const [scope, lim] = await Promise.all([this.scope(), this.limits()]);
    const reps = await this.representations(scope);
    const byPlatform = new Map<string, number>();
    const source = new Map<string, string>();
    let unavailable = 0;
    for (const r of reps) {
      try {
        const p = await this.binance.rwaUnderlyingProfile({ binanceChainId: "56", tokenContractAddress: this.twin(r.token) });
        for (const [k, v] of Object.entries(p.protections ?? {})) {
          if (!/daily/i.test(k)) continue;
          const ts = v?.updatedAt ? Math.floor(v.updatedAt > 1e12 ? v.updatedAt / 1000 : v.updatedAt) : dateFromUrl(v?.url ?? "");
          if (!ts) continue;
          if (ts > (byPlatform.get(r.platform) ?? 0)) {
            byPlatform.set(r.platform, ts);
            source.set(r.platform, `binance daily attestation report ${v?.url ?? ""}`.trim());
          }
        }
      } catch (e) {
        unavailable++;
        if (!(e instanceof FixtureMissingError)) this.log.warn("underlying-profile failed", { token: r.token, err: (e as Error).message });
      }
    }

    /*
     * An issuer whose collateral proof is onchain publishes no dated PDF: bStocks' profile carries a collateral
     * report with `supported: true` and a null url, because the proof is `uiMultiplier()` on the token itself.
     * Gating that issuer on a document date would stop its buys forever. For an ERC-8056 platform the keeper
     * therefore attests to what it can verify directly — it reads the multiplier off every representation of
     * that platform, and posts the time of the read. Nothing is invented: if a read fails, nothing is posted.
     */
    for (const platform of new Set(reps.filter((r) => r.source === "ERC8056").map((r) => r.platform))) {
      if (byPlatform.has(platform)) continue; // a dated report exists; prefer it
      const members = reps.filter((r) => r.platform === platform && r.source === "ERC8056");
      let read = 0;
      for (const r of members) {
        try {
          const live = await this.pub.readContract({ address: r.token, abi: Erc8056Abi, functionName: "uiMultiplier" });
          if (live > 0n) read++;
        } catch {
          /* one unreadable token is enough to withhold the attestation for the platform */
          read = -1;
          break;
        }
      }
      if (read === members.length && read > 0) {
        byPlatform.set(platform, Math.floor(Date.now() / 1000));
        source.set(platform, `onchain ERC-8056 multiplier read on ${read} representation(s); this issuer publishes no dated report`);
      }
    }
    let posted = 0;
    const now = Math.floor(Date.now() / 1000);
    // every platform in scope is checked for staleness, including the ones whose source failed above: an
    // attestation that ages out blocks every buy of that issuer, and the warning has to come before the cliff
    for (const platform of new Set(reps.map((r) => r.platform))) {
      const current = Number(await this.pub.readContract({ ...this.registry, functionName: "attestedAt", args: [tickerToId(platform)] }));
      const ts = byPlatform.get(platform) ?? 0;
      const ageAfter = now - Math.max(current, ts);
      if (ageAfter > lim.attestationAge / 2) {
        this.alert(`${platform} attestation is ${Math.round(ageAfter / 3600)}h old and the newest available is ${ts ? new Date(ts * 1000).toISOString().slice(0, 10) : "none"}; buys of this issuer stop at ${Math.round(lim.attestationAge / 3600)}h — post one with \`keeper attest\``, { platform, current, source: ts || null });
      }
      if (!ts || ts <= current) continue;
      await this.submit({ kind: "postAttestation", to: this.registry.address, data: encodeFunctionData({ ...this.registry, functionName: "postAttestation", args: [tickerToId(platform), BigInt(ts)] }), note: `${platform} attested ${new Date(ts * 1000).toISOString()} (${source.get(platform) ?? "binance daily attestation report"})` });
      posted++;
    }
    this.state.lastRun.attestations = { at: Date.now(), ok: true, note: `${posted} posted, ${unavailable} tokens without source` };
  }

  /** Manual, human-verified attestation posting with provenance (used when the API is unavailable). */
  async attestManual(platform: string, isoDate: string, sourceUrl: string) {
    const ts = Math.floor(new Date(isoDate).getTime() / 1000);
    if (!Number.isFinite(ts)) throw new Error("bad date");
    return this.submit({ kind: "postAttestation", to: this.registry.address, data: encodeFunctionData({ ...this.registry, functionName: "postAttestation", args: [tickerToId(platform), BigInt(ts)] }), note: `${platform} attested ${isoDate} (manual, source: ${sourceUrl})` });
  }

  /**
   * Market state per underlying from Binance statusInfo; otherwise the computed NYSE calendar (labeled). Posted
   * only on a change, and only on a network whose resolver reads it from the registry — see POST_MARKET_STATE.
   */
  async jobMarketState() {
    if (!this.cfg.postMarketState) {
      this.state.lastRun.market = { at: Date.now(), ok: true, note: "not posted on this network: no contract reads it and the resolver takes market status from Binance (set POST_MARKET_STATE=true to post anyway)" };
      return;
    }
    const scope = await this.scope();
    const ids = (await this.pub.readContract({ ...this.registry, functionName: "underlyingIds" })).filter((i) => scope.has(i.toLowerCase()));
    let statuses: Map<string, boolean> | null = null;
    try {
      const list = await this.binance.rwaTokens({ binanceChainId: "56" });
      statuses = new Map();
      for (const t of list) if (t.underlyingTicker && typeof t.statusInfo?.openState === "boolean") statuses.set(t.underlyingTicker.toUpperCase(), t.statusInfo.openState);
    } catch {
      /* fall through to computed */
    }
    const computed = computedOpen(new Date());
    let posted = 0;
    for (const id of ids) {
      const ticker = idToTicker(id);
      const open = statuses?.get(ticker) ?? computed;
      const cur = await this.pub.readContract({ ...this.registry, functionName: "marketState", args: [id] });
      // only on change. A market state that matches what is already posted tells no one anything new, and the
      // resolver falls back to the exchange calendar when nothing was ever posted.
      if (cur.updatedAt !== 0n && cur.open === open) continue;
      await this.submit({ kind: "postMarketState", to: this.registry.address, data: encodeFunctionData({ ...this.registry, functionName: "postMarketState", args: [id, open] }), note: `${ticker} ${open ? "OPEN" : "CLOSED"} (${statuses?.has(ticker) ? "binance statusInfo" : "computed calendar"})` });
      posted++;
    }
    this.state.lastRun.market = { at: Date.now(), ok: true, note: `${posted} posted (${statuses ? "binance" : "computed"})` };
  }

  /**
   * Hybrid demo: keep the mock venue and mock multipliers at mainnet's values. For every mock with a twin, the
   * venue price becomes the twin's live catalogue `tokenPrice` (USD per raw token) once it drifts by at least
   * MIRROR_DRIFT_BPS, and an ERC-8056 mock's `uiMultiplier` follows the twin's onchain multiplier. Nothing is
   * posted without a live source; a missing price leaves the mock where it is and is counted.
   */
  async jobMirror() {
    if (!this.cfg.hybrid || !this.cfg.deployment.venue) {
      this.state.lastRun.mirror = { at: Date.now(), ok: true, note: "not a hybrid network" };
      return;
    }
    const venue = { address: this.cfg.deployment.venue, abi: MockSwapTargetAbi } as const;
    const list = await this.binance.rwaTokens({ binanceChainId: "56" });
    const live = new Map(list.map((t) => [t.tokenContractAddress.toLowerCase(), t]));
    let priced = 0, multipliers = 0, unchanged = 0, missing = 0;
    for (const twin of this.cfg.twins.values()) {
      const t = live.get(twin.token.toLowerCase());
      if (!t?.tokenPrice) { missing++; continue; }
      const price = parseWad(t.tokenPrice);
      const current = await this.pub.readContract({ ...venue, functionName: "price", args: [twin.mock] });
      if (current === 0n || Number(stepBps(current, price)) >= this.cfg.MIRROR_DRIFT_BPS) {
        await this.submit({ kind: "mirrorPrice", to: venue.address, data: encodeFunctionData({ ...venue, functionName: "setPrice", args: [twin.mock, price] }), note: `${twin.symbol} venue price ${formatWad(price, 4)} USD/token (mainnet catalogue tokenPrice)` });
        priced++;
      } else unchanged++;
      const mock = { address: twin.mock, abi: MockStockTokenAbi } as const;
      if (await this.pub.readContract({ ...mock, functionName: "erc8056" })) {
        const [mine, theirs] = await Promise.all([
          this.pub.readContract({ ...mock, functionName: "uiMultiplier" }),
          this.mainnet.readContract({ address: twin.token, abi: Erc8056Abi, functionName: "uiMultiplier" }),
        ]);
        if (mine !== theirs) {
          await this.submit({ kind: "mirrorMultiplier", to: twin.mock, data: encodeFunctionData({ ...mock, functionName: "setMultiplier", args: [theirs] }), note: `${twin.symbol} uiMultiplier ${formatWad(theirs, 6)} (mainnet ${twin.token})` });
          multipliers++;
        }
      }
    }
    this.state.lastRun.mirror = { at: Date.now(), ok: true, note: `${priced} prices, ${multipliers} multipliers posted; ${unchanged} within ${this.cfg.MIRROR_DRIFT_BPS} bps; ${missing} without a live price` };
  }

  /** Migration bot: asks the resolver for share-accretive migrations and executes them via the permissionless path. */
  async jobMigrations() {
    let list: Array<{ basket: Address; ticker: string; from: string; to: string; gainBps: number; why: string; tx: { to: Address; data: Hex } }> = [];
    try {
      const res = await fetch(`${this.cfg.RESOLVER_URL}/migrations?minGainBps=${this.cfg.MIGRATION_MIN_GAIN_BPS}`);
      if (!res.ok) throw new Error(`resolver ${res.status}`);
      list = (await res.json()) as typeof list;
    } catch (e) {
      this.state.lastRun.migrations = { at: Date.now(), ok: false, note: `resolver unavailable: ${(e as Error).message}` };
      return;
    }
    let done = 0;
    for (const m of list) {
      await this.submit({ kind: "migrate", to: m.tx.to, data: m.tx.data, note: `${m.ticker} ${m.from} -> ${m.to} (+${m.gainBps} bps): ${m.why}` });
      done++;
    }
    this.state.lastRun.migrations = { at: Date.now(), ok: true, note: `${done} of ${list.length} opportunities submitted` };
  }

  async runAllOnce() {
    // ordered by what each unblocks per transaction: an attestation is two txs and gates every buy of an issuer,
    // a ratio gates one representation, a price gates mandate buys only, market state gates nothing.
    for (const [name, job] of [["mirror", () => this.jobMirror()], ["attestations", () => this.jobAttestations()], ["ratios", () => this.jobRatios()], ["prices", () => this.jobPrices()], ["market", () => this.jobMarketState()], ["migrations", () => this.jobMigrations()]] as const) {
      try {
        await job();
      } catch (e) {
        this.state.lastRun[name] = { at: Date.now(), ok: false, note: (e as Error).message };
        this.log.error(`${name} failed`, { err: (e as Error).message });
      }
    }
  }

  start() {
    const every = (ms: number, fn: () => Promise<void>, name: string) => {
      const run = () => fn().catch((e) => { this.state.lastRun[name] = { at: Date.now(), ok: false, note: (e as Error).message }; this.log.error(`${name} failed`, { err: (e as Error).message }); });
      run();
      this.timers.push(setInterval(run, ms));
    };
    if (this.cfg.hybrid) every(this.cfg.MIRROR_INTERVAL_MS, () => this.jobMirror(), "mirror");
    every(this.cfg.RATIO_INTERVAL_MS, () => this.jobRatios(), "ratios");
    every(this.cfg.PRICE_INTERVAL_MS, () => this.jobPrices(), "prices");
    every(this.cfg.ATTESTATION_INTERVAL_MS, () => this.jobAttestations(), "attestations");
    every(this.cfg.MARKET_INTERVAL_MS, () => this.jobMarketState(), "market");
    every(this.cfg.MIGRATION_INTERVAL_MS, () => this.jobMigrations(), "migrations");
    this.log.info("keeper started", { dryRun: this.dryRun, chainId: this.cfg.CHAIN_ID, account: this.account?.address ?? null, binance: this.binance.mode, hybrid: this.cfg.hybrid, twins: this.cfg.twins.size });
  }

  stop() {
    this.timers.forEach(clearInterval);
  }
}

/**
 * Whether a keeper-sourced ratio is worth a transaction right now. Two reasons only: it moved by at least
 * `minMoveBps`, or it has reached half of the registry's own max age and a missed run would let it expire.
 * Nothing else — an unchanged, fresh ratio re-posted on a timer is the whole of a keeper's gas bill and none
 * of its value.
 */
export function ratioNeedsPost(p: { posted: bigint; live: bigint; ageSec: number; windowSec: number; minMoveBps: number }): string | null {
  if (p.posted === 0n) return "never posted";
  const move = Number(stepBps(p.posted, p.live));
  if (move >= p.minMoveBps) return `moved ${move} bps`;
  if (p.ageSec >= p.windowSec / 2) return `${Math.round(p.ageSec / 3600)}h old, half of the ${Math.round(p.windowSec / 3600)}h window`;
  return null;
}

/** Why the keeper must not send right now, or null: the balance floor first, then the rolling daily cap. */
export function budgetVerdict(p: { balanceWei: bigint; floorWei: bigint; txsToday: number; capPerDay: number }): string | null {
  if (p.txsToday >= p.capPerDay) return `daily cap reached (${p.capPerDay} txs)`;
  if (p.balanceWei < p.floorWei) return `balance ${formatWad(p.balanceWei, 6)} BNB below the ${formatWad(p.floorWei, 6)} floor`;
  return null;
}

/** "…/2026-09-17…" or "…20260917…" in an attestation URL -> unix seconds (00:00 UTC of that day). */
export function dateFromUrl(url: string): number | null {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(url) ?? /(\d{4})(\d{2})(\d{2})/.exec(url);
  if (!m) return null;
  const ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 1000;
  return Number.isFinite(ts) && ts > 1_600_000_000 ? ts : null;
}

/** Same calendar as the resolver's computed fallback (kept tiny here to avoid a dependency). */
export function computedOpen(now: Date): boolean {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit", minute: "2-digit", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  const holidays = new Set(["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"]);
  const ymd = `${p.year}-${p.month}-${p.day}`;
  return p.weekday !== "Sat" && p.weekday !== "Sun" && !holidays.has(ymd) && minutes >= 570 && minutes < 960;
}
