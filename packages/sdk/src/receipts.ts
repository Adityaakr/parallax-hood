import { type Address, type Hex, type Log, decodeEventLog, parseAbiItem, toEventSelector } from "viem";
import { idToTicker } from "./ids.js";

export const RouteReceiptEvent = parseAbiItem(
  "event RouteReceipt(bytes32 indexed quoteHash, address indexed actor, bytes32 indexed underlyingId, address tokenIn, uint256 amountIn, address representation, uint256 tokensOut, uint256 sharesOut, uint256 ratio, uint64 attestedAt, uint8 action)",
);
export const ROUTE_RECEIPT_TOPIC = toEventSelector(RouteReceiptEvent);

/** The vault's own record of a rebalance: which constituent moved, how many shares it gained, under which quote. */
export const MigratedEvent = parseAbiItem(
  "event Migrated(bytes32 indexed underlyingId, address indexed caller, uint256 shareGain, bytes32 quoteHash)",
);
export const MIGRATED_TOPIC = toEventSelector(MigratedEvent);

export const ACTIONS = ["buy", "sell", "mint", "redeem", "migrate"] as const;
export type Action = (typeof ACTIONS)[number];

export type RouteReceipt = {
  quoteHash: Hex;
  actor: Address;
  underlyingId: Hex;
  ticker: string;
  tokenIn: Address;
  amountIn: bigint;
  representation: Address;
  tokensOut: bigint;
  sharesOut: bigint;
  ratio: bigint;
  attestedAt: number;
  action: Action;
  emitter: Address; // router or vault
  txHash?: Hex;
  blockNumber?: bigint;
  logIndex?: number;
};

export function decodeRouteReceipt(log: Pick<Log, "data" | "topics" | "address"> & Partial<Pick<Log, "transactionHash" | "blockNumber" | "logIndex">>): RouteReceipt | null {
  if (log.topics[0] !== ROUTE_RECEIPT_TOPIC) return null;
  const { args } = decodeEventLog({ abi: [RouteReceiptEvent], data: log.data, topics: log.topics });
  return {
    quoteHash: args.quoteHash,
    actor: args.actor,
    underlyingId: args.underlyingId,
    ticker: idToTicker(args.underlyingId),
    tokenIn: args.tokenIn,
    amountIn: args.amountIn,
    representation: args.representation,
    tokensOut: args.tokensOut,
    sharesOut: args.sharesOut,
    ratio: args.ratio,
    attestedAt: Number(args.attestedAt),
    action: ACTIONS[args.action] ?? "buy",
    emitter: log.address,
    txHash: log.transactionHash ?? undefined,
    blockNumber: log.blockNumber ?? undefined,
    logIndex: log.logIndex ?? undefined,
  };
}

export function serializeReceipt(r: RouteReceipt) {
  return {
    ...r,
    amountIn: r.amountIn.toString(),
    tokensOut: r.tokensOut.toString(),
    sharesOut: r.sharesOut.toString(),
    ratio: r.ratio.toString(),
    blockNumber: r.blockNumber?.toString(),
  };
}
