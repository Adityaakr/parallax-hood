import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // production builds go to their own directory so `next build` never clobbers a running `next dev`
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@parallax-hood/sdk"],
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // optional deps pulled in by wallet connectors that are not installed (and not needed)
    for (const m of ["@x402/evm", "@x402/core", "@x402/fetch", "@x402/svm", "@react-native-async-storage/async-storage", "@farcaster/mini-app-solana"]) config.resolve.alias[m] = false;
    return config;
  },
};
export default nextConfig;
