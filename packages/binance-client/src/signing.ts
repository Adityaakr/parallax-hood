import { createHmac } from "node:crypto";

/**
 * Binance Web3 API request signing (verified against binance-common `web3_signature`):
 *   preHash  = timestamp + METHOD + "/build" + path + ("?" + query if query) + body
 *   X-OC-SIGN = base64(HMAC-SHA256(secret, preHash))
 * `timestamp` is ISO 8601 UTC with milliseconds, e.g. 2026-05-11T10:08:57.715Z.
 */
export function isoTimestamp(now = new Date()): string {
  return now.toISOString(); // already "YYYY-MM-DDTHH:mm:ss.sssZ"
}

export function preHash(p: { timestamp: string; method: string; path: string; query: string; body: string }): string {
  const q = p.query ? `?${p.query}` : "";
  return `${p.timestamp}${p.method.toUpperCase()}/build${p.path}${q}${p.body}`;
}

export function signHmac(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("base64");
}

/** Query string exactly as Python's urlencode(query, True): keys in insertion order, quote_plus encoding. */
export function encodeQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.append(k, String(v));
  }
  return sp.toString();
}

export function buildHeaders(p: {
  apiKey: string;
  apiSecret: string;
  method: string;
  path: string;
  query: string;
  body: string;
  recvWindow?: number;
  nonce?: string;
  now?: Date;
}): Record<string, string> {
  const timestamp = isoTimestamp(p.now);
  const sign = signHmac(p.apiSecret, preHash({ timestamp, method: p.method, path: p.path, query: p.query, body: p.body }));
  return {
    "X-OC-APIKEY": p.apiKey,
    "X-OC-TIMESTAMP": timestamp,
    "X-OC-SIGN": sign,
    "X-OC-RECV-WINDOW": String(p.recvWindow ?? 15000),
    "X-OC-NONCE": p.nonce ?? "",
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}
