import { type Address, getAddress } from "viem";
import { z } from "zod";

export const DeploymentSchema = z.object({
  chainId: z.number(),
  deployBlock: z.number().optional(),
  admin: z.string().optional(),
  keeper: z.string().optional(),
  usdt: z.string(),
  registry: z.string(),
  router: z.string(),
  factory: z.string(),
  mandate: z.string(),
  venue: z.string().optional(),
  mocks: z.record(z.string()).optional(),
}).passthrough();

export type Deployment = {
  chainId: number;
  deployBlock?: number;
  usdt: Address;
  registry: Address;
  router: Address;
  factory: Address;
  mandate: Address;
  venue?: Address;
  mocks?: Record<string, Address>;
  baskets: Record<string, Address>; // symbol -> address (from basket_<symbol> keys)
};

/** Parse a contracts/deployments/<chainId>.json document. */
export function parseDeployment(json: unknown): Deployment {
  const d = DeploymentSchema.parse(json);
  const baskets: Record<string, Address> = {};
  for (const [k, v] of Object.entries(d)) {
    if (k.startsWith("basket_") && typeof v === "string") baskets[k.slice(7)] = getAddress(v);
  }
  return {
    chainId: d.chainId,
    deployBlock: d.deployBlock,
    usdt: getAddress(d.usdt),
    registry: getAddress(d.registry),
    router: getAddress(d.router),
    factory: getAddress(d.factory),
    mandate: getAddress(d.mandate),
    venue: d.venue ? getAddress(d.venue) : undefined,
    mocks: d.mocks ? Object.fromEntries(Object.entries(d.mocks).map(([k, v]) => [k, getAddress(v)])) : undefined,
    baskets,
  };
}

export type MockTwin = { mock: Address; token: Address; ticker: string; symbol: string; platform: string };

/**
 * Hybrid demo: pairs every mock token in a deployment (`mocks`: symbol → address) with the mainnet token of the
 * same symbol from the universe config, so market reads for a mock go to the real token while execution stays
 * on the mock network. Keyed by lower-cased mock address.
 */
export function mockTwins(deployment: Pick<Deployment, "mocks">, representations: { symbol: string; token: string; ticker: string; platform: string }[]): Map<string, MockTwin> {
  const out = new Map<string, MockTwin>();
  for (const [symbol, mock] of Object.entries(deployment.mocks ?? {})) {
    const real = representations.find((r) => r.symbol === symbol);
    if (real) out.set(mock.toLowerCase(), { mock: getAddress(mock), token: getAddress(real.token), ticker: real.ticker, symbol, platform: real.platform });
  }
  return out;
}
