import { createWalletClient, http, formatEther, parseEther, type Abi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { StockRegistryAbi, MockSwapTargetAbi, MockStockTokenAbi, Erc8056Abi, WAD, formatWad, mockTwins } from "@parallax-hood/sdk";
import type { Chain } from "./chain.js";
import type { Venues } from "./providers/venues.js";
import { serial } from "./txLock.js";
import { logger } from "./log.js";

const log = logger("mirror");

/** Below this the operator stops sending and says so, rather than failing one transaction at a time. */
const GAS_FLOOR = parseEther("0.0002");

export type MirrorLine = {
  ticker: string;
  /** USD per token: the mainnet pool's midpoint, and what the mock venue here is set to */
  venue: { mainnet: string | null; here: string | null; driftBps: number | null; route: string | null };
  /** USD per share: mainnet's Chainlink answer over the mainnet multiplier, and what the registry here holds */
  reference: { mainnet: string | null; here: string | null; driftBps: number | null; postedAt: number | null };
  multiplier: { mainnet: string | null; here: string | null; equal: boolean | null };
  /** transactions sent for this stock in the last run */
  sent: { what: string; tx: Hex }[];
  errors: string[];
};
export type MirrorStatus = {
  enabled: boolean;
  operator: Address | null;
  intervalS: number;
  thresholdBps: number;
  lastRunAt: number | null;
  /** the last run that read every stock and left none of them further from mainnet than the threshold */
  lastInSyncAt: number | null;
  lastWriteAt: number | null;
  writes: number;
  operatorEth: string | null;
  error: string | null;
  stocks: MirrorLine[];
};

const drift = (a: bigint, b: bigint) => (b === 0n ? Number.MAX_SAFE_INTEGER : Number(((a > b ? a - b : b - a) * 10_000n) / b));

/**
 * Keeps a mock deployment on mainnet's numbers. The testnet has no Uniswap pools and no Chainlink feeds, so its
 * venue, its registry reference and its stock tokens' multipliers were set once at deploy time and would stay
 * there. This copies the live values over, stock by stock:
 *   - the mock venue's price for a token   <- the midpoint of that token's mainnet Uniswap v3 pools
 *   - the registry's reference price       <- the token's mainnet Chainlink answer, over its mainnet multiplier
 *   - the mock token's multiplier (and a scheduled change) <- the mainnet token's `uiMultiplier()`
 * A value is written when it has moved more than the threshold, and the reference at least once per heartbeat.
 * The registry bounds what a keeper may post (20 % per day for a price, 5 % for a ratio checkpoint); a move
 * past that is reported and left for the admin, exactly as it would be for a real keeper.
 *
 * It only ever runs against a deployment that records mock tokens, never mainnet or a fork of it. What it
 * cannot make real is the tokens themselves: balances here are test tokens and the venue fills any size at one
 * price, with none of the real pools' price impact.
 */
export class Mirror {
  private status: MirrorStatus;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly account;
  private readonly wallet;

  constructor(private readonly chain: Chain, private readonly venues: Venues) {
    const cfg = chain.cfg;
    const pk = cfg.MIRROR_PRIVATE_KEY;
    const allowed = Boolean(pk) && cfg.hybrid && Boolean(chain.d.mocks) && Boolean(chain.d.venue) && cfg.network !== "robinhood" && cfg.network !== "fork";
    if (pk && !allowed) log.warn("MIRROR_PRIVATE_KEY is set but this is not a hybrid mock network; the mirror stays off", { network: cfg.network, hybrid: cfg.hybrid });
    this.account = allowed ? privateKeyToAccount(pk as Hex) : null;
    this.wallet = this.account ? createWalletClient({ account: this.account, chain: cfg.chain, transport: http(cfg.rpcUrl) }) : null;
    this.status = {
      enabled: allowed, operator: this.account?.address ?? null, intervalS: cfg.MIRROR_INTERVAL_S, thresholdBps: cfg.MIRROR_THRESHOLD_BPS,
      lastRunAt: null, lastInSyncAt: null, lastWriteAt: null, writes: 0, operatorEth: null, error: null, stocks: [],
    };
  }

  get enabled() {
    return this.status.enabled;
  }

  snapshot(): MirrorStatus {
    return this.status;
  }

  start() {
    if (!this.enabled || this.timer) return;
    const tick = () => void this.runOnce().catch((e) => log.warn("mirror run failed", { err: (e as Error).message }));
    tick();
    this.timer = setInterval(tick, this.chain.cfg.MIRROR_INTERVAL_S * 1000);
    this.timer.unref();
    log.info("mirror started", { operator: this.account!.address, intervalS: this.chain.cfg.MIRROR_INTERVAL_S, thresholdBps: this.chain.cfg.MIRROR_THRESHOLD_BPS });
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Simulate, send, wait. One transaction at a time for this key, shared with the faucet. */
  private async send(address: Address, abi: Abi, functionName: string, args: readonly unknown[]): Promise<Hex> {
    const account = this.account!;
    return serial(account.address, async () => {
      const { request } = await this.chain.client.simulateContract({ account, address, abi, functionName, args } as never);
      const hash = await this.wallet!.writeContract(request as never);
      const receipt = await this.chain.client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`${functionName} reverted in ${hash}`);
      this.status.writes++;
      this.status.lastWriteAt = Math.floor(Date.now() / 1000);
      return hash;
    });
  }

  /** One pass over every stock. Reads first, writes only what moved. Safe to call by hand; overlapping calls are dropped. */
  async runOnce(): Promise<MirrorStatus> {
    if (!this.enabled || this.running) return this.status;
    this.running = true;
    try {
      const { chain } = this;
      const cfg = chain.cfg;
      const balance = await chain.client.getBalance({ address: this.account!.address });
      this.status.operatorEth = formatEther(balance);
      if (balance < GAS_FLOOR) {
        this.status.error = `operator ${this.account!.address} holds ${formatEther(balance)} test ETH; top it up to keep mirroring`;
        this.status.lastRunAt = Math.floor(Date.now() / 1000);
        log.warn(this.status.error);
        return this.status;
      }
      const now = await chain.now();
      const lines: MirrorLine[] = [];
      // one stock at a time: the public mainnet RPC answers 429 past a few dozen concurrent calls
      for (const twin of mockTwins(chain.d, chain.catalogue.universe.representations).values()) {
        const line: MirrorLine = {
          ticker: twin.ticker,
          venue: { mainnet: null, here: null, driftBps: null, route: null },
          reference: { mainnet: null, here: null, driftBps: null, postedAt: null },
          multiplier: { mainnet: null, here: null, equal: null },
          sent: [], errors: [],
        };
        lines.push(line);
        const step = async (what: string, fn: () => Promise<void>) => {
          try {
            await fn();
          } catch (e) {
            const msg = ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).split("\n")[0]!;
            line.errors.push(`${what}: ${msg}`);
            log.warn("mirror step failed", { ticker: twin.ticker, what, err: msg });
          }
        };

        // 1. multiplier, first: both prices below are per token or per share through it
        let multiplier: bigint | null = null;
        await step("multiplier", async () => {
          const read = (client: typeof chain.client, token: Address) => Promise.all([
            client.readContract({ address: token, abi: Erc8056Abi, functionName: "uiMultiplier" }),
            client.readContract({ address: token, abi: Erc8056Abi, functionName: "newUIMultiplier" }),
            client.readContract({ address: token, abi: Erc8056Abi, functionName: "effectiveAt" }),
          ]);
          const [real, nextReal, effReal] = await read(chain.mainnet, twin.token);
          let [here, nextHere, effHere] = await read(chain.client, twin.mock);
          multiplier = real;
          if (here !== real) {
            line.sent.push({ what: `multiplier ${formatWad(here, 18)} -> ${formatWad(real, 18)}`, tx: await this.send(twin.mock, MockStockTokenAbi, "setMultiplier", [real]) });
            // a scheduled change that already took effect on the mock would keep overriding the value just set
            if (effHere !== 0n && Number(effHere) <= now) line.sent.push({ what: "clear the elapsed schedule", tx: await this.send(twin.mock, MockStockTokenAbi, "scheduleMultiplier", [0n, 0n]) });
            line.sent.push({ what: "checkpoint the new multiplier in the registry", tx: await this.send(chain.d.registry, StockRegistryAbi, "checkpointRatio", [twin.mock]) });
            [here, nextHere, effHere] = await read(chain.client, twin.mock);
          }
          // a change the issuer has scheduled on mainnet and that has not taken effect yet
          if (nextReal !== real && Number(effReal) > now && (nextHere !== nextReal || effHere !== effReal)) {
            line.sent.push({ what: `schedule multiplier ${formatWad(nextReal, 18)} at ${effReal}`, tx: await this.send(twin.mock, MockStockTokenAbi, "scheduleMultiplier", [nextReal, effReal]) });
          }
          line.multiplier = { mainnet: formatWad(real, 18), here: formatWad(here, 18), equal: here === real };
        });

        // 2. the venue's price for the token <- the mainnet pools' midpoint
        await step("venue price", async () => {
          const [market, here] = await Promise.all([
            this.venues.marketPrice(twin.mock),
            chain.client.readContract({ address: chain.d.venue!, abi: MockSwapTargetAbi, functionName: "price", args: [twin.mock] }),
          ]);
          line.venue.here = formatWad(here, 6);
          if (!market) throw new Error("no mainnet pool answered a quote");
          line.venue = { mainnet: formatWad(market.mid, 6), here: formatWad(here, 6), driftBps: drift(here, market.mid), route: market.venue };
          if (line.venue.driftBps! >= cfg.MIRROR_THRESHOLD_BPS) {
            line.sent.push({ what: `venue price ${formatWad(here, 4)} -> ${formatWad(market.mid, 4)}`, tx: await this.send(chain.d.venue!, MockSwapTargetAbi, "setPrice", [twin.mock, market.mid]) });
            line.venue.here = formatWad(market.mid, 6);
            line.venue.driftBps = 0;
          }
        });

        // 3. the registry's reference <- mainnet's Chainlink answer for the token, over the mainnet multiplier
        await step("reference price", async () => {
          const id = chain.tickerId(twin.ticker);
          const [cl, [here, postedAt]] = await Promise.all([
            chain.chainlinkPrice(twin.ticker),
            chain.client.readContract({ address: chain.d.registry, abi: StockRegistryAbi, functionName: "referencePrice", args: [id] }),
          ]);
          line.reference.here = formatWad(here, 6);
          line.reference.postedAt = Number(postedAt);
          if (!cl || !multiplier) throw new Error("no mainnet Chainlink answer");
          const real = (((cl.price * WAD) / 10n ** BigInt(cl.decimals)) * WAD) / multiplier;
          line.reference = { mainnet: formatWad(real, 6), here: formatWad(here, 6), driftBps: drift(here, real), postedAt: Number(postedAt) };
          const aged = now - Number(postedAt) > cfg.MIRROR_HEARTBEAT_S;
          if (line.reference.driftBps! >= cfg.MIRROR_THRESHOLD_BPS || aged) {
            line.sent.push({ what: `reference ${formatWad(here, 4)} -> ${formatWad(real, 4)}${aged ? " (heartbeat)" : ""}`, tx: await this.send(chain.d.registry, StockRegistryAbi, "postReferencePrice", [id, real]) });
            line.reference = { mainnet: formatWad(real, 6), here: formatWad(real, 6), driftBps: 0, postedAt: now };
          }
        });
      }
      const at = Math.floor(Date.now() / 1000);
      const sent = lines.flatMap((l) => l.sent);
      const errors = lines.flatMap((l) => l.errors);
      if (sent.length) chain.invalidate();
      this.status.stocks = lines;
      this.status.lastRunAt = at;
      this.status.error = errors.length ? `${errors.length} step(s) failed in the last run` : null;
      if (!errors.length && lines.length) this.status.lastInSyncAt = at;
      if (sent.length || errors.length) log.info("mirror run", { sent: sent.length, errors: errors.length, operatorEth: this.status.operatorEth });
      return this.status;
    } finally {
      this.running = false;
    }
  }
}
