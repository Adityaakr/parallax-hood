/** Token bucket: `capacity` tokens refilled at `refillPerSec`. `take()` resolves when a token is available. */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();
  constructor(private capacity: number, private refillPerSec: number) {
    this.tokens = capacity;
  }
  private refill() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
    this.last = now;
  }
  async take(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const wait = ((1 - this.tokens) / this.refillPerSec) * 1000;
      await new Promise((r) => setTimeout(r, Math.max(5, wait)));
    }
  }
}

export class TtlCache<V> {
  private m = new Map<string, { v: V; exp: number }>();
  get(k: string): V | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (Date.now() > e.exp) {
      this.m.delete(k);
      return undefined;
    }
    return e.v;
  }
  set(k: string, v: V, ttlMs: number) {
    this.m.set(k, { v, exp: Date.now() + ttlMs });
  }
  clear() {
    this.m.clear();
  }
}

export async function withBackoff<T>(fn: () => Promise<T>, opts: { retries: number; baseMs: number; shouldRetry: (e: unknown) => boolean; onRetry?: (e: unknown, attempt: number, delay: number) => void }): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= opts.retries || !opts.shouldRetry(e)) throw e;
      const retryAfter = (e as { retryAfterMs?: number })?.retryAfterMs;
      const delay = retryAfter ?? opts.baseMs * 2 ** attempt + Math.random() * 100;
      opts.onRetry?.(e, attempt, delay);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}
