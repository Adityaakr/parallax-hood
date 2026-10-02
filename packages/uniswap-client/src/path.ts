import { type Address, type Hex, encodePacked } from "viem";

/** A route through one or more pools: `tokens[i]` → `tokens[i+1]` through the pool with fee `fees[i]`. */
export type Route = { tokens: Address[]; fees: number[] };

/** v3 path bytes: token0 fee0 token1 fee1 token2 … (exact-input order). */
export function encodePath(route: Route): Hex {
  if (route.tokens.length < 2 || route.tokens.length !== route.fees.length + 1) throw new Error("path length mismatch");
  const types: string[] = [];
  const values: (Address | number)[] = [];
  route.tokens.forEach((t, i) => {
    types.push("address");
    values.push(t);
    if (i < route.fees.length) {
      types.push("uint24");
      values.push(route.fees[i]!);
    }
  });
  return encodePacked(types, values);
}

/** The same route written backwards, which is how exact-output paths are encoded. */
export function reversePath(route: Route): Route {
  return { tokens: [...route.tokens].reverse(), fees: [...route.fees].reverse() };
}

/** "uniswap-v3:500" for one hop, "uniswap-v3:500>3000" for two. The label a quote and its receipt carry. */
export function routeLabel(fees: readonly number[]): string {
  return `uniswap-v3:${fees.join(">")}`;
}
