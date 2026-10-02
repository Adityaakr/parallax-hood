# Parallax on Robinhood Chain

Share-denominated routing, USDG-settled index vaults and onchain agent mandates for tokenized stocks, ported
from the BNB Chain deployment of [Parallax](https://github.com/Adityaakr/parallax) to Robinhood Chain.

**Status: port in progress.** This tree starts as a self-contained copy of the BNB Chain workspace and is being
adapted commit by commit. Until this notice is replaced, the code, docs and addresses below the top level still
describe the BNB Chain product, and nothing here is deployed on Robinhood Chain.

What holds today:

- The workspace installs and builds on its own (`pnpm install`, then `pnpm build`).
- `cd contracts && forge test` passes: 124 tests, including the fuzz and invariant suites.
- The TypeScript suites pass for the SDK, the quoting client, the resolver and the keeper.

Every Robinhood Chain address will be recorded in `docs/addresses.md` with the official page it came from and
the onchain call that confirmed it.
