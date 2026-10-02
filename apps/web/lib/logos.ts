/*
 * Logos, and where each one came from.
 *
 * Robinhood Chain: the files in public/brand are the ones in Robinhood's own brand pack
 * (docs.robinhood.com/chain/brand-guidelines, "robinhood-chain-brand-assets-v1.zip"), copied without changes.
 * Those guidelines are the rules for showing them: exactly as provided, never recoloured, cropped, rotated or
 * combined with other marks, black on white or on Robin Neon (#ccff00), white on black, the feather at 20px or
 * taller. The feather avatar is used as the network's badge and the full logo on its own neon card.
 *
 * Companies: public/stocks holds one mark per listed stock on a white round tile, so it reads the same on the
 * light and the dark theme. They identify the company a stock token tracks and nothing more.
 */
export const ROBINHOOD_CHAIN = {
  avatar: "/brand/robinhood-feather-avatar.jpg",
  logoBlack: "/brand/robinhood-chain-logo-black.svg",
  logoWhite: "/brand/robinhood-chain-logo-white.svg",
  /** the full logo's own proportions (viewBox 1576 x 207) */
  logoRatio: 1576 / 207,
  neon: "#ccff00",
} as const;

const STOCK_LOGOS: Record<string, string> = {
  NVDA: "/stocks/nvda.svg",
  AAPL: "/stocks/aapl.svg",
  MSFT: "/stocks/msft.svg",
  AMZN: "/stocks/amzn.svg",
  GOOGL: "/stocks/googl.svg",
  META: "/stocks/meta.svg",
  TSLA: "/stocks/tsla.svg",
};

/** The company mark for a ticker, or null when there is none and a lettered tile should stand in. */
export const stockLogo = (ticker: string): string | null => STOCK_LOGOS[ticker.toUpperCase()] ?? null;

/** Networks that are Robinhood Chain itself, its testnet or a fork of it, and so carry its badge. */
export const isRobinhoodChain = (chainId: number) => chainId === 4663 || chainId === 46630 || chainId === 31337;
