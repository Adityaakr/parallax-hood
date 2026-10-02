import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Parallax on Robinhood Chain",
  description: "A token is not a share. Parallax measures Robinhood stock tokens in underlying shares: USDG index vaults, agent mandates enforced on chain, and execution priced per share. Runs on Robinhood Chain Testnet; mainnet deployment is pending. Unaudited. Not available to U.S. persons.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/*
        No font preloads. The two faces above the fold are declared in globals.css, which Next inlines into this
        same document, so the browser finds them without a hint; behind a CDN the hint stopped matching the
        request the stylesheet made and the console filled with "preloaded but not used" for every page view.
        `font-display: swap` covers the gap either way.
      */}
      <body>
        {children}
      </body>
    </html>
  );
}
