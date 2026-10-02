import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { preHash, signHmac, encodeQuery, buildHeaders, isoTimestamp } from "../src/signing.js";

describe("Binance Web3 signing", () => {
  it("builds the documented pre-hash string", () => {
    // Example from the official docs (Authentication page)
    const ph = preHash({
      timestamp: "2026-05-11T10:08:57.715Z",
      method: "get",
      path: "/api/v1/dex/market/price",
      query: "chainId=1&symbol=ETH%20USDT",
      body: "",
    });
    expect(ph).toBe("2026-05-11T10:08:57.715ZGET/build/api/v1/dex/market/price?chainId=1&symbol=ETH%20USDT");
  });
  it("omits '?' without a query and appends the raw body for POST", () => {
    expect(preHash({ timestamp: "T", method: "POST", path: "/p", query: "", body: '{"a":1}' })).toBe("TPOST/build/p{\"a\":1}");
  });
  it("HMAC-SHA256 base64 matches node crypto reference", () => {
    const secret = "s3cr3t";
    const msg = "hello";
    expect(signHmac(secret, msg)).toBe(createHmac("sha256", secret).update(msg).digest("base64"));
  });
  it("encodes query like python urlencode(quote_plus) and skips empty values", () => {
    expect(encodeQuery({ binanceChainId: "56", tokenContractAddresses: "0xa,0xb", x: undefined, y: "", z: 0 })).toBe(
      "binanceChainId=56&tokenContractAddresses=0xa%2C0xb&z=0",
    );
  });
  it("sets all X-OC headers with ms-precision ISO timestamp", () => {
    const h = buildHeaders({ apiKey: "k", apiSecret: "s", method: "GET", path: "/p", query: "a=1", body: "", now: new Date("2026-09-17T15:00:00.123Z") });
    expect(h["X-OC-APIKEY"]).toBe("k");
    expect(h["X-OC-TIMESTAMP"]).toBe("2026-09-17T15:00:00.123Z");
    expect(h["X-OC-SIGN"]).toBe(signHmac("s", "2026-09-17T15:00:00.123ZGET/build/p?a=1"));
    expect(h["X-OC-RECV-WINDOW"]).toBe("15000");
    expect(isoTimestamp(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
  });
});
