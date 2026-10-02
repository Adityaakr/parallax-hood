import { type Address, type Hex, encodeFunctionData, encodePacked } from "viem";
import { UniswapSwapRouter02Abi, MockSwapTargetAbi } from "./abis.js";

/** Mirrors `LegExecutor.Leg`. */
export type Leg = {
  target: Address;
  data: Hex;
  tokenIn: Address;
  maxIn: bigint;
  tokenOut: Address;
};

/** Single-hop Uniswap v3 leg (SwapRouter02). `recipient` must be the contract that executes the leg. */
export function uniswapExactInputSingleLeg(p: {
  router: Address;
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  amountIn: bigint;
  amountOutMinimum: bigint;
  recipient: Address;
}): Leg {
  const data = encodeFunctionData({
    abi: UniswapSwapRouter02Abi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: p.tokenIn,
        tokenOut: p.tokenOut,
        fee: p.fee,
        recipient: p.recipient,
        amountIn: p.amountIn,
        amountOutMinimum: p.amountOutMinimum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  return { target: p.router, data, tokenIn: p.tokenIn, maxIn: p.amountIn, tokenOut: p.tokenOut };
}

/** Exact-output single-hop leg: receive exactly `amountOut`, spend at most `amountInMaximum` (= leg.maxIn). */
export function uniswapExactOutputSingleLeg(p: {
  router: Address;
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  amountOut: bigint;
  amountInMaximum: bigint;
  recipient: Address;
}): Leg {
  const data = encodeFunctionData({
    abi: UniswapSwapRouter02Abi,
    functionName: "exactOutputSingle",
    args: [
      {
        tokenIn: p.tokenIn,
        tokenOut: p.tokenOut,
        fee: p.fee,
        recipient: p.recipient,
        amountOut: p.amountOut,
        amountInMaximum: p.amountInMaximum,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  return { target: p.router, data, tokenIn: p.tokenIn, maxIn: p.amountInMaximum, tokenOut: p.tokenOut };
}

/** Multi-hop path encoding: token0 fee0 token1 fee1 token2 ... */
export function encodeV3Path(tokens: Address[], fees: number[]): Hex {
  if (tokens.length !== fees.length + 1) throw new Error("path length mismatch");
  const types: string[] = [];
  const values: (Address | number)[] = [];
  tokens.forEach((t, i) => {
    types.push("address");
    values.push(t);
    if (i < fees.length) {
      types.push("uint24");
      values.push(fees[i]!);
    }
  });
  return encodePacked(types, values);
}

export function uniswapExactInputLeg(p: {
  router: Address;
  tokens: Address[];
  fees: number[];
  amountIn: bigint;
  amountOutMinimum: bigint;
  recipient: Address;
}): Leg {
  const data = encodeFunctionData({
    abi: UniswapSwapRouter02Abi,
    functionName: "exactInput",
    args: [{ path: encodeV3Path(p.tokens, p.fees), recipient: p.recipient, amountIn: p.amountIn, amountOutMinimum: p.amountOutMinimum }],
  });
  return { target: p.router, data, tokenIn: p.tokens[0]!, maxIn: p.amountIn, tokenOut: p.tokens[p.tokens.length - 1]! };
}

/** Multi-hop exact-output leg. `tokens`/`fees` are in swap order; the router wants the path written backwards. */
export function uniswapExactOutputLeg(p: {
  router: Address;
  tokens: Address[];
  fees: number[];
  amountOut: bigint;
  amountInMaximum: bigint;
  recipient: Address;
}): Leg {
  const data = encodeFunctionData({
    abi: UniswapSwapRouter02Abi,
    functionName: "exactOutput",
    args: [{ path: encodeV3Path([...p.tokens].reverse(), [...p.fees].reverse()), recipient: p.recipient, amountOut: p.amountOut, amountInMaximum: p.amountInMaximum }],
  });
  return { target: p.router, data, tokenIn: p.tokens[0]!, maxIn: p.amountInMaximum, tokenOut: p.tokens[p.tokens.length - 1]! };
}

/** Leg against the MockSwapTarget venue (testnet / local mocks). */
export function mockVenueLeg(p: {
  venue: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minOut: bigint;
  recipient: Address;
}): Leg {
  const data = encodeFunctionData({
    abi: MockSwapTargetAbi,
    functionName: "swap",
    args: [p.tokenIn, p.tokenOut, p.amountIn, p.minOut, p.recipient],
  });
  return { target: p.venue, data, tokenIn: p.tokenIn, maxIn: p.amountIn, tokenOut: p.tokenOut };
}

/** Serialize legs for JSON transport (bigint -> decimal string). */
export function serializeLegs(legs: Leg[]) {
  return legs.map((l) => ({ ...l, maxIn: l.maxIn.toString() }));
}
export function deserializeLegs(legs: Array<Omit<Leg, "maxIn"> & { maxIn: string }>): Leg[] {
  return legs.map((l) => ({ ...l, maxIn: BigInt(l.maxIn) }));
}
