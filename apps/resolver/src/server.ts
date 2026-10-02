import { serve } from "@hono/node-server";
import { loadConfig } from "./config.js";
import { createApp, createServices } from "./app.js";
import { logger } from "./log.js";

const log = logger("server");
const cfg = loadConfig();
const services = createServices(cfg);
if (!cfg.quoteOnly) services.indexer.start(); // nothing to index without our contracts
if (cfg.network === "fork") {
  // cold anvil forks fetch pool state lazily; warm every registered representation once in the background
  services.chain.allUnderlyings().then((us) => services.resolver.venues.warmup(us.flatMap((u) => u.representations.map((r) => r.token)))).then(() => log.info("fork warm-up done")).catch(() => {});
}
/*
 * Warm the index shelf before anyone asks for it. `/baskets` prices three indices across seven constituents,
 * each through pool depth, Chainlink rounds and daily closes: about twenty seconds cold, under a second once
 * the memos are filled. Doing it at boot means the first visitor gets the warm path, and repeating it keeps
 * the shelf warm rather than letting it expire into another cold request.
 */
if (!cfg.quoteOnly || cfg.CHAIN_ID === 4663) {
  const warm = () =>
    services.baskets.refreshCards();
  void warm();
  setInterval(warm, 60_000).unref();
}

// keep a mock deployment on mainnet's prices and multipliers (off unless HYBRID_MARKETS and MIRROR_PRIVATE_KEY are set)
services.mirror.start();

const app = createApp(services);
serve({ fetch: app.fetch, port: cfg.PORT }, (info) => {
  log.info("resolver listening", { port: info.port, chainId: cfg.CHAIN_ID, network: cfg.network, rpc: cfg.rpcUrl, universe: services.chain.catalogue.universe.representations.length });
});
