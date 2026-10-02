import { type Address, getAddress } from "viem";
import { z } from "zod";

/** Where Uniswap v3 lives on a chain: the three contracts a quote and a contract-executed swap need. */
export const UniswapV3DeploymentSchema = z.object({
  factory: z.string().transform((a) => getAddress(a)),
  quoterV2: z.string().transform((a) => getAddress(a)),
  swapRouter02: z.string().transform((a) => getAddress(a)),
  /** Fee tiers the factory has enabled (`feeAmountTickSpacing(fee) != 0`). */
  fees: z.array(z.number().int().positive()).min(1),
});
export type UniswapV3Deployment = { factory: Address; quoterV2: Address; swapRouter02: Address; fees: readonly number[] };

/**
 * Uniswap v3 on Robinhood Chain (chain id 4663), from Uniswap's deployment page
 * https://docs.uniswap.org/contracts/v3/reference/deployments/ ("Robinhood Chain Deployments"). Checked on-chain:
 * every address has code, `QuoterV2.factory()` and `SwapRouter02.factory()` both return the factory, and the
 * factory enables exactly these four fee tiers (2500 is not enabled). See docs/addresses.md.
 */
export const ROBINHOOD_UNISWAP_V3: UniswapV3Deployment = {
  factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  quoterV2: "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7",
  swapRouter02: "0xCaf681a66D020601342297493863E78C959E5cb2",
  fees: [100, 500, 3000, 10000],
};

/** By chain id. A local fork of Robinhood Chain (31337) holds the same contracts at the same addresses. */
export const UNISWAP_V3_DEPLOYMENTS: Record<number, UniswapV3Deployment> = {
  4663: ROBINHOOD_UNISWAP_V3,
  31337: ROBINHOOD_UNISWAP_V3,
};
