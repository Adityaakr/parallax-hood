import { describe, it, expect } from "vitest";
import { keccak256, encodeAbiParameters, parseAbiParameters, type Hex, decodeFunctionData } from "viem";
import { tickerToId, idToTicker } from "../src/ids.js";
import { uniswapExactInputSingleLeg, encodeV3Path, uniswapExactInputLeg, uniswapExactOutputLeg, mockVenueLeg, serializeLegs, deserializeLegs } from "../src/legs.js";
import { decodeRouteReceipt, ROUTE_RECEIPT_TOPIC, RouteReceiptEvent } from "../src/receipts.js";
import { UniswapSwapRouter02Abi } from "../src/abis.js";
import { ROBINHOOD_ADDRESSES } from "../src/chains.js";
import { parseDeployment } from "../src/deployments.js";
import { encodeEventTopics, encodeAbiParameters as enc } from "viem";

const A = "0x1111111111111111111111111111111111111111" as const;
const B = "0x2222222222222222222222222222222222222222" as const;

describe("ids", () => {
  it("mirrors bytes32(bytes('NVDA'))", () => {
    expect(tickerToId("NVDA")).toBe("0x4e56444100000000000000000000000000000000000000000000000000000000");
    expect(idToTicker(tickerToId("GOOGL"))).toBe("GOOGL");
    expect(tickerToId("bstock")).toBe("0x6273746f636b0000000000000000000000000000000000000000000000000000");
    expect(() => tickerToId("")).toThrow();
  });
});

describe("legs", () => {
  it("encodes exactInputSingle with recipient and selector 0x04e45aaf", () => {
    const leg = uniswapExactInputSingleLeg({ router: ROBINHOOD_ADDRESSES.uniswapSwapRouter02, tokenIn: A, tokenOut: B, fee: 500, amountIn: 100n, amountOutMinimum: 1n, recipient: A });
    expect(leg.data.slice(0, 10)).toBe("0x04e45aaf");
    const d = decodeFunctionData({ abi: UniswapSwapRouter02Abi, data: leg.data });
    expect(d.functionName).toBe("exactInputSingle");
    expect((d.args[0] as any).recipient).toBe(A);
    expect(leg.maxIn).toBe(100n);
    expect(leg.tokenOut).toBe(B);
  });
  it("encodes v3 paths", () => {
    const p = encodeV3Path([A, B], [2500]);
    expect(p.length).toBe(2 + 40 + 6 + 40);
    expect(p.slice(42, 48)).toBe("0009c4");
    expect(() => encodeV3Path([A], [1])).toThrow();
    const leg = uniswapExactInputLeg({ router: A, tokens: [A, B], fees: [500], amountIn: 5n, amountOutMinimum: 0n, recipient: B });
    expect(leg.tokenIn).toBe(A);
    expect(leg.tokenOut).toBe(B);
  });
  it("encodes a two-hop exact-output leg with the path reversed", () => {
    const C = "0x3333333333333333333333333333333333333333" as const;
    const leg = uniswapExactOutputLeg({ router: A, tokens: [A, B, C], fees: [500, 3000], amountOut: 9n, amountInMaximum: 20n, recipient: B });
    const d = decodeFunctionData({ abi: UniswapSwapRouter02Abi, data: leg.data });
    expect(d.functionName).toBe("exactOutput");
    expect((d.args[0] as any).path).toBe(encodeV3Path([C, B, A], [3000, 500]));
    expect(leg.tokenIn).toBe(A);
    expect(leg.tokenOut).toBe(C);
    expect(leg.maxIn).toBe(20n);
  });
  it("mock venue leg + (de)serialize", () => {
    const leg = mockVenueLeg({ venue: A, tokenIn: A, tokenOut: B, amountIn: 7n, minOut: 0n, recipient: B });
    const wire = serializeLegs([leg]);
    expect(wire[0]!.maxIn).toBe("7");
    expect(deserializeLegs(wire)[0]!.maxIn).toBe(7n);
  });
});

describe("receipts", () => {
  it("decodes a RouteReceipt log", () => {
    const quoteHash = keccak256("0x01") as Hex;
    const topics = encodeEventTopics({ abi: [RouteReceiptEvent], args: { quoteHash, actor: A, underlyingId: tickerToId("NVDA") } });
    const data = enc(parseAbiParameters("address,uint256,address,uint256,uint256,uint256,uint64,uint8"), [A, 100n, B, 5n, 6n, 7n, 123n, 2]);
    const r = decodeRouteReceipt({ address: B, data, topics: topics as any, transactionHash: "0xab", blockNumber: 9n, logIndex: 1 });
    expect(topics[0]).toBe(ROUTE_RECEIPT_TOPIC);
    expect(r?.ticker).toBe("NVDA");
    expect(r?.action).toBe("mint");
    expect(r?.sharesOut).toBe(6n);
    expect(r?.attestedAt).toBe(123);
    expect(decodeRouteReceipt({ address: B, data, topics: ["0x00" as Hex] })).toBeNull();
  });
});

describe("deployments", () => {
  it("parses baskets from basket_* keys", () => {
    const d = parseDeployment({ chainId: 31337, usdg: A, registry: A, router: A, factory: A, mandate: A, basket_pxMAG7: B, mocks: { NVDAB: A } });
    expect(d.baskets.pxMAG7).toBe(B);
    expect(d.mocks?.NVDAB).toBe(A);
  });
});
