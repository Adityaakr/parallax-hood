/**
 * One transaction at a time per signing key. The faucet and the mirror may share a key on the testnet, and two
 * sends racing for the same nonce would have one of them rejected.
 */
const tails = new Map<string, Promise<unknown>>();

export function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const k = key.toLowerCase();
  const run = (tails.get(k) ?? Promise.resolve()).then(fn, fn);
  tails.set(k, run.catch(() => undefined));
  return run;
}
