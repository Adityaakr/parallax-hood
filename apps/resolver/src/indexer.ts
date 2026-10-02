import type { Address } from "viem";
import { MigratedEvent, RouteReceiptEvent, decodeRouteReceipt, idToTicker } from "@parallax-hood/sdk";
import type { Chain } from "./chain.js";
import type { Db } from "./db.js";
import { logger } from "./log.js";

const log = logger("indexer");
const CHUNK = 2_000n;

/** Polls RouteReceipt and Migrated logs from the router and every basket, stores them in SQLite, resumes from the last block. */
export class Indexer {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(private chain: Chain, private db: Db, private fromBlock: bigint | undefined, private pollMs: number) {}

  private key() {
    return `indexer:${this.chain.cfg.CHAIN_ID}:last`;
  }

  /** Block timestamps, memoized: a chunk usually holds several logs from the same block. */
  private times = new Map<string, number>();
  private async blockTime(n: bigint | null): Promise<number | null> {
    if (n === null) return null;
    const k = n.toString();
    const hit = this.times.get(k);
    if (hit !== undefined) return hit;
    try {
      const t = Number((await this.chain.client.getBlock({ blockNumber: n })).timestamp);
      if (this.times.size > 500) this.times.clear();
      this.times.set(k, t);
      return t;
    } catch {
      return null;
    }
  }

  async sources(): Promise<Address[]> {
    return [this.chain.d.router, ...(await this.chain.baskets())];
  }

  async syncOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const head = await this.chain.client.getBlockNumber({ cacheTime: 0 });
      const saved = this.db.getKv(this.key());
      const deployBlock = this.chain.d.deployBlock !== undefined ? BigInt(this.chain.d.deployBlock) : undefined;
      let from = saved ? BigInt(saved) + 1n : (this.fromBlock ?? deployBlock ?? (head > 2_000n ? head - 2_000n : 0n));
      if (from > head) return 0;
      const baskets = await this.chain.baskets();
      const addresses = [this.chain.d.router, ...baskets];
      let count = 0;
      while (from <= head) {
        const to = from + CHUNK - 1n > head ? head : from + CHUNK - 1n;
        const logs = await this.chain.client.getLogs({ address: addresses, event: RouteReceiptEvent, fromBlock: from, toBlock: to });
        for (const l of logs) {
          const r = decodeRouteReceipt(l);
          if (!r) continue;
          const ts = await this.blockTime(l.blockNumber);
          this.db.putReceipt({
            tx_hash: l.transactionHash!, log_index: l.logIndex!, block_number: Number(l.blockNumber), emitter: l.address, quote_hash: r.quoteHash,
            actor: r.actor, underlying: r.ticker, token_in: r.tokenIn, amount_in: r.amountIn.toString(), representation: r.representation,
            tokens_out: r.tokensOut.toString(), shares_out: r.sharesOut.toString(), ratio: r.ratio.toString(), attested_at: r.attestedAt, action: r.action,
            timestamp: ts ?? 0,
          });
          count++;
        }
        // the vault's own rebalance record: the gain is the number the invariant protects, so it is read from the event
        const migrations = baskets.length ? await this.chain.client.getLogs({ address: [...baskets], event: MigratedEvent, fromBlock: from, toBlock: to }) : [];
        for (const l of migrations) {
          const a = l.args as { underlyingId?: `0x${string}`; caller?: `0x${string}`; shareGain?: bigint; quoteHash?: `0x${string}` };
          if (!a.underlyingId || !a.caller || a.shareGain === undefined || !a.quoteHash) continue;
          this.db.putRebalance({
            tx_hash: l.transactionHash!, log_index: l.logIndex!, block_number: Number(l.blockNumber), basket: l.address,
            underlying_id: a.underlyingId, caller: a.caller, share_gain: a.shareGain.toString(), quote_hash: a.quoteHash,
            timestamp: (await this.blockTime(l.blockNumber)) ?? 0,
          });
          log.info("indexed rebalance", { basket: l.address, ticker: idToTicker(a.underlyingId), gain: a.shareGain.toString() });
          count++;
        }
        this.db.setKv(this.key(), to.toString());
        from = to + 1n;
      }
      if (count) {
        log.info("indexed receipts", { count, head: head.toString() });
        this.chain.invalidate();
      }
      return count;
    } catch (e) {
      log.warn("sync failed", { err: (e as Error).message });
      return 0;
    } finally {
      this.running = false;
    }
  }

  start() {
    void this.syncOnce();
    this.timer = setInterval(() => void this.syncOnce(), this.pollMs);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
  }
}
