import { describe, it, expect, beforeAll } from "vitest";
import { createPublicClient, defineChain, http, type Address, type PublicClient, zeroAddress } from "viem";
import { UniswapV3Client, ROBINHOOD_UNISWAP_V3, encodePath, reversePath, routeLabel } from "../src/index.js";

const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as Address;
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as Address;
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC" as Address;
const pair = (a: string, b: string) => [a.toLowerCase(), b.toLowerCase()].sort().join(":");

/**
 * A chain small enough to reason about: pools keyed by pair and fee, each a constant-rate market with a fee.
 * Only the three calls the client makes are answered, so a call it should not make fails the test.
 */
function fakeChain(pools: { a: Address; b: Address; fee: number; liquidity: bigint; balA: bigint; balB: bigint; rate: bigint /* b per a, 1e18 */ }[]) {
  const calls = { getPool: 0, quotes: 0 };
  const addr = (i: number) => `0x${(i + 1).toString(16).padStart(40, "0")}` as Address;
  const find = (x: Address, y: Address, fee: number) => pools.findIndex((p) => pair(p.a, p.b) === pair(x, y) && p.fee === fee);
  const swap = (tokenIn: Address, tokenOut: Address, fee: number, amountIn: bigint) => {
    const p = pools[find(tokenIn, tokenOut, fee)];
    if (!p || p.liquidity === 0n) throw new Error("revert");
    const net = (amountIn * BigInt(1_000_000 - fee)) / 1_000_000n;
    return tokenIn.toLowerCase() === p.a.toLowerCase() ? (net * p.rate) / 10n ** 18n : (net * 10n ** 18n) / p.rate;
  };
  const client = {
    readContract: async ({ address, functionName, args }: { address: Address; functionName: string; args?: unknown[] }) => {
      if (functionName === "getPool") {
        calls.getPool++;
        const i = find(args![0] as Address, args![1] as Address, args![2] as number);
        return i < 0 ? zeroAddress : addr(i);
      }
      if (functionName === "balanceOf") {
        const p = pools[Number(BigInt(args![0] as string)) - 1]!;
        return address.toLowerCase() === p.a.toLowerCase() ? p.balA : p.balB;
      }
      const p = pools[Number(BigInt(address)) - 1]!;
      if (functionName === "liquidity") return p.liquidity;
      if (functionName === "token0") return p.a.toLowerCase() < p.b.toLowerCase() ? p.a : p.b;
      throw new Error(`unexpected read ${functionName}`);
    },
    simulateContract: async ({ functionName, args }: { functionName: string; args: any[] }) => {
      calls.quotes++;
      if (functionName === "quoteExactInputSingle") {
        const q = args[0];
        return { result: [swap(q.tokenIn, q.tokenOut, q.fee, q.amountIn), 0n, 1, 90_000n] };
      }
      throw new Error(`unexpected simulate ${functionName}`);
    },
  } as unknown as PublicClient;
  return { client, calls };
}

describe("path encoding", () => {
  it("packs token, fee, token", () => {
    const path = encodePath({ tokens: [USDG, WETH, NVDA], fees: [500, 3000] });
    expect(path).toBe(`0x${USDG.slice(2)}0001f4${WETH.slice(2)}000bb8${NVDA.slice(2)}`.toLowerCase());
  });
  it("rejects a route whose fees do not match its hops", () => {
    expect(() => encodePath({ tokens: [USDG, NVDA], fees: [] })).toThrow("path length mismatch");
  });
  it("reverses for exact-output and labels by fee", () => {
    expect(reversePath({ tokens: [USDG, WETH, NVDA], fees: [500, 3000] })).toEqual({ tokens: [NVDA, WETH, USDG], fees: [3000, 500] });
    expect(routeLabel([500])).toBe("uniswap-v3:500");
    expect(routeLabel([500, 3000])).toBe("uniswap-v3:500>3000");
  });
});

describe("UniswapV3Client", () => {
  // 1 USDG (1e6) buys 1/232 NVDA (1e18): rate is NVDA wei per USDG unit, 1e18-scaled
  const rate = (10n ** 18n * 10n ** 18n) / (232n * 10n ** 6n);
  const pools = [
    { a: USDG, b: NVDA, fee: 500, liquidity: 10n ** 19n, balA: 2_700_000n * 10n ** 6n, balB: 3_751n * 10n ** 18n, rate },
    { a: USDG, b: NVDA, fee: 3000, liquidity: 10n ** 16n, balA: 19_000n * 10n ** 6n, balB: 28n * 10n ** 18n, rate },
    { a: USDG, b: NVDA, fee: 100, liquidity: 10n ** 16n, balA: 82n * 10n ** 6n, balB: 10n ** 15n, rate: rate * 2n }, // dust pool with a tempting price
    { a: USDG, b: NVDA, fee: 10000, liquidity: 0n, balA: 11n * 10n ** 6n, balB: 10n ** 16n, rate },
  ];

  it("drops pools below the minimum balance or without in-range liquidity", async () => {
    const { client } = fakeChain(pools);
    const u = new UniswapV3Client({ client, deployment: ROBINHOOD_UNISWAP_V3, minPoolBalance: { [USDG]: 1_000n * 10n ** 6n } });
    expect((await u.pools(USDG, NVDA)).map((p) => p.fee).sort((a, b) => a - b)).toEqual([100, 500, 3000, 10000]);
    expect((await u.liquidPools(USDG, NVDA)).map((p) => p.fee).sort((a, b) => a - b)).toEqual([500, 3000]);
  });

  it("returns the tier that pays out the most, net of its fee", async () => {
    const { client } = fakeChain(pools);
    const u = new UniswapV3Client({ client, deployment: ROBINHOOD_UNISWAP_V3, minPoolBalance: { [USDG]: 1_000n * 10n ** 6n } });
    const q = await u.bestExactInput(USDG, NVDA, 100n * 10n ** 6n);
    expect(q?.venue).toBe("uniswap-v3:500");
    // 100 USDG less 0.05 % at $232 a token
    expect(q?.amountOut).toBe((((100n * 10n ** 6n * 999_500n) / 1_000_000n) * rate) / 10n ** 18n);
    expect(q?.route).toEqual({ tokens: [USDG, NVDA], fees: [500] });
  });

  it("answers null, not zero, when nothing can fill", async () => {
    const { client } = fakeChain([]);
    const u = new UniswapV3Client({ client, deployment: ROBINHOOD_UNISWAP_V3 });
    expect(await u.bestExactInput(USDG, NVDA, 100n * 10n ** 6n)).toBeNull();
    expect(await u.bestExactInput(USDG, NVDA, 0n)).toBeNull();
    expect(await u.depth(USDG, NVDA)).toEqual({ balance: 0n, fees: [], deepestFee: null });
  });

  it("looks pool addresses up once", async () => {
    const { client, calls } = fakeChain(pools);
    const u = new UniswapV3Client({ client, deployment: ROBINHOOD_UNISWAP_V3 });
    await u.bestExactInput(USDG, NVDA, 100n * 10n ** 6n);
    await u.bestExactInput(NVDA, USDG, 10n ** 18n);
    expect(calls.getPool).toBe(ROBINHOOD_UNISWAP_V3.fees.length);
  });

  it("reports depth in the quote token and names the deepest tier", async () => {
    const { client } = fakeChain(pools);
    const u = new UniswapV3Client({ client, deployment: ROBINHOOD_UNISWAP_V3, minPoolBalance: { [USDG]: 1_000n * 10n ** 6n } });
    expect(await u.depth(USDG, NVDA)).toEqual({ balance: 2_719_000n * 10n ** 6n, fees: [500, 3000], deepestFee: 500 });
  });
});

/** Against the real chain. Set ROBINHOOD_RPC_URL (the public endpoint works) to run it. */
describe.skipIf(!process.env.ROBINHOOD_RPC_URL)("Robinhood Chain mainnet (live)", () => {
  // built in beforeAll: a skipped suite's body still runs at collection, and a transport without a URL throws
  let u: UniswapV3Client;
  beforeAll(() => {
    // multicall batching keeps a public endpoint's rate limit out of the way
    const chain = defineChain({
      id: 4663, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC_URL!] } },
      contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
    });
    const client = createPublicClient({ chain, transport: http(undefined, { retryCount: 5, retryDelay: 500 }), batch: { multicall: { wait: 16 } } });
    u = new UniswapV3Client({ client, deployment: ROBINHOOD_UNISWAP_V3, minPoolBalance: { [USDG]: 1_000n * 10n ** 6n } });
  });

  it("quotes 100 USDG into NVDA and back within a few percent", async () => {
    const buy = await u.bestExactInput(USDG, NVDA, 100n * 10n ** 6n, [WETH]);
    expect(buy).not.toBeNull();
    const sell = await u.bestExactInput(NVDA, USDG, buy!.amountOut, [WETH]);
    expect(sell).not.toBeNull();
    expect(sell!.amountOut).toBeGreaterThan(95n * 10n ** 6n);
    expect(sell!.amountOut).toBeLessThan(100n * 10n ** 6n);
  }, 60_000);

  it("prices exact-output consistently with exact-input", async () => {
    const out = 10n ** 17n; // 0.1 NVDA
    const need = await u.bestExactOutput(USDG, NVDA, out, [WETH]);
    expect(need).not.toBeNull();
    const got = await u.quoteExactInput(need!.route, need!.amountIn);
    // the two quotes are two eth_calls a block or more apart on a live market, so they agree to a few bps, not to the wei
    const diff = got!.amountOut > out ? got!.amountOut - out : out - got!.amountOut;
    expect(diff * 10_000n).toBeLessThan(out * 10n);
  }, 60_000);
});
