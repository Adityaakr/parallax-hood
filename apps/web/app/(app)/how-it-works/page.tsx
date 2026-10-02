import { A } from "@/components/ui";
import { Page, PageHead } from "@/components/Page";

const PARTS: [string, string][] = [
  [
    "Routing in shares",
    "A Robinhood stock token is an ERC-20 whose multiplier, read on chain (ERC-8056 uiMultiplier), says how many underlying shares one token stands for. Parallax multiplies tokens by that multiplier and quotes, compares and protects every order in shares. A buy reverts unless the shares received meet the minimum the quote promised.",
  ],
  [
    "Quotes from the chain",
    "Prices come from the Uniswap v3 pools on Robinhood Chain, read through the quoter: the direct USDG pool at each fee tier, or two hops through WETH. The resolver scores each route by cost per underlying share with fees, price impact and gas included, simulates the transaction, and records why it chose the route under a quote hash that the on-chain receipt carries.",
  ],
  [
    "Index vaults settled in USDG",
    "An index unit is a fixed number of shares of each constituent, not a dollar amount. Minting pulls USDG, buys every constituent and checks that the vault holds at least the shares its units require. Unspent USDG is returned in the same transaction.",
  ],
  [
    "Redeem in kind",
    "A holder can always take their pro-rata slice of the tokens the vault holds. This path uses no price, no oracle and no pause switch that Parallax controls, and it carries no protocol fee.",
  ],
  [
    "Agent mandate",
    "A wallet owner can let an agent key trade inside limits the contract enforces: a per-transaction cap and a daily cap in USDG, an expiry, an allowlist of stocks and indices, and a floor on the price it may accept. Whatever the agent buys goes to the owner, never to the agent, and the owner can revoke at any time.",
  ],
];

const TRUSTED: [string, string][] = [
  ["The admin key", "One key registers tokens and swap targets, sets the fee and the supply caps, and can pause new buys. It cannot pause selling or redeeming in kind, and it cannot move anyone's assets. A production deployment would put it behind a multisig and a timelock."],
  ["Robinhood, as issuer", "Robinhood can pause a stock token, block an address, burn tokens and upgrade the token contracts. A paused or blocked token cannot leave a vault until the issuer lifts it; the other constituents and the rest of an in-kind redemption are not affected."],
  ["Paxos, as issuer of USDG", "Paxos can pause USDG and freeze an address. Parallax takes USDG at one dollar."],
  ["Chainlink feeds", "Reference prices come from Chainlink feeds that update 24 hours a day, 5 days a week, from Sunday 20:00 to Friday 20:00 New York time. They stop over the weekend. A stale reference price blocks agent buys only, never an owner's own trade or an exit."],
  ["The resolver", "The resolver is an off-chain service that proposes routes. The contracts do not trust it: swap targets are allowlisted, results are measured by balance changes, and the share minimum is checked on chain."],
];

function AboutInner() {
  return (
    <div className="prose-sm max-w-4xl mx-auto space-y-8">
      <section>
        <PageHead eyebrow="In detail" title="How Parallax works on Robinhood Chain" />
        <p className="muted mt-6 leading-relaxed">
          Parallax buys Robinhood stock tokens with USDG on Robinhood Chain, measures every fill in underlying
          shares, packages positions into index vaults whose unit is a fixed number of shares, and lets a wallet
          owner delegate to an agent through a contract the agent cannot exceed.
        </p>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        {PARTS.map(([title, text], i) => (
          <div key={title} className="card p-4">
            <div className="font-medium">{i + 1} · {title}</div>
            <p className="muted text-sm mt-1 leading-relaxed">{text}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="text-lg font-medium">What is trusted</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {TRUSTED.map(([who, what]) => (
            <li key={who}><b>{who}.</b> <span className="muted">{what}</span></li>
          ))}
        </ul>
      </section>

      <section className="text-sm">
        <h2 className="text-lg font-medium">Limits at launch</h2>
        <ul className="mt-2 space-y-2">
          <li><b>Unaudited.</b> <span className="muted">The contracts have tests, fuzzing and invariant suites, and no external audit.</span></li>
          <li><b>Supply caps.</b> <span className="muted">Each index vault starts with a cap on the units it can mint, set by the admin. The cap is checked on mint only, so it never blocks a redemption.</span></li>
          <li><b>Test networks use mocks.</b> <span className="muted">On the testnet and on local chains the stock tokens, USDG and the swap venue are mocks, and the banner at the top of every page says so. On the testnet their prices and multipliers are copied from mainnet as they move, and the banner says when they last matched.</span></li>
        </ul>
      </section>

      <section className="text-sm">
        <h2 className="text-lg font-medium">Eligibility</h2>
        <p className="muted mt-2 leading-relaxed">
          Robinhood Stock Tokens are not registered under U.S. securities laws and may not be offered or sold in
          the United States or to U.S. persons. They are also restricted in other jurisdictions. See Robinhood&apos;s
          terms for <A href="https://docs.robinhood.com/chain/stock-tokens">stock tokens</A> and its list of{" "}
          <A href="https://docs.robinhood.com/rhj/restricted-jurisdictions">restricted jurisdictions</A>. Parallax
          does not geolocate users; you are responsible for your eligibility. Not investment advice. Index tokens
          are vault receipts, not an investment product.
        </p>
        <p className="muted mt-2">
          Source, tests, the threat model and the on-chain check behind every address: <A href="https://github.com/Adityaakr/parallax-hood">github.com/Adityaakr/parallax-hood</A>.
        </p>
      </section>
    </div>
  );
}

export default function About() {
  return (
    <Page>
      <AboutInner />
    </Page>
  );
}
