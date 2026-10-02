import { type Hex, stringToHex, hexToString, isHex } from "viem";

/** Right-padded ASCII ticker as bytes32, e.g. "NVDA" -> 0x4e564441000...  Mirrors `bytes32(bytes("NVDA"))`. */
export function tickerToId(ticker: string): Hex {
  if (ticker.length === 0 || ticker.length > 32) throw new Error(`bad ticker ${ticker}`);
  return stringToHex(ticker, { size: 32 });
}

export function idToTicker(id: Hex): string {
  if (!isHex(id) || id.length !== 66) throw new Error(`bad id ${id}`);
  return hexToString(id, { size: 32 }).replace(/\0+$/, "");
}

export const platformToId = tickerToId;
export const idToPlatform = idToTicker;
