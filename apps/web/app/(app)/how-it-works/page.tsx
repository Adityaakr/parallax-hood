import { A } from "@/components/ui";
import { Page, PageHead } from "@/components/Page";
import { FragmentationTable } from "@/components/app/frames";

function AboutInner() {
  return (
    <div className="prose-sm max-w-4xl mx-auto space-y-8">
      <section>
        <PageHead eyebrow="In detail" title="How Parallax works" />
        <p className="muted mt-6 leading-relaxed">
          Tokenized stocks on BNB Chain are fragmented. The same company exists as several tokens from different issuers, with different contracts, token-to-share ratios, liquidity, attestation reports, prices and behavior when the US market is closed. A user or an agent who wants &ldquo;$500 of NVDA&rdquo; should not have to understand any of this. An index that wants &ldquo;0.10 NVDA shares per unit&rdquo; should not care which token supplies them.
        </p>
      </section>

      <section>
        <div className="eyebrow mb-3">The fragmentation problem, in one table</div>
        <FragmentationTable />
      </section>

      <section className="grid md:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="font-medium">1 · Resolver</div>
          <p className="muted text-sm mt-1">
            Finds every representation on BSC, normalizes to shares with each token&apos;s ratio, pulls executable quotes (PancakeSwap v3 quoter; Binance aggregator for comparison), checks attestation freshness and market state, scores effective cost per share, applies your policy and returns a ranked explanation plus an unsigned, pre-simulated transaction.
          </p>
        </div>
        <div className="card p-4">
          <div className="font-medium">2 · ShareRouter &amp; baskets</div>
          <p className="muted text-sm mt-1">
            Executes routes with slippage protection in shares, not token units, only into allowlisted, attestation-fresh representations, and emits a receipt linking to the scoring record. Baskets define a unit as fixed shares per stock; mint, redeem, redeem in kind and permissionless migration are all invariant-checked.
          </p>
        </div>
        <div className="card p-4">
          <div className="font-medium">3 · Agent mandates</div>
          <p className="muted text-sm mt-1">
            A wallet owner authorizes an agent key within hard limits enforced onchain: per-tx cap, daily cap, expiry, allowed stocks and baskets. Outputs go to the owner. Revocation is instant. The MCP server adds soft policy on top and can only act through this contract.
          </p>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium">Invariants, in plain words</h2>
        <ul className="mt-2 space-y-2 text-sm">
          <li><b>Backing.</b> For every stock in a basket, the vault holds at least (units outstanding × shares per unit) shares, counted across every issuer&apos;s token at its current ratio. Checked after every mint and migration. Redeems only remove your pro-rata slice.</li>
          <li><b>Redeem in kind always works.</b> No pause, no oracle, no stale keeper data can stop a holder from taking their pro-rata tokens out. If an issuer freezes one token, you can skip that slice and take everything else.</li>
          <li><b>Migrate is monotone.</b> Anyone can swap a constituent from one issuer&apos;s token to another, but only if the share count strictly rises, nothing else falls, and issuer caps hold. Anyone can improve the basket; nobody can hurt it.</li>
          <li><b>Share-denominated slippage.</b> A buy reverts unless the shares received (tokens × ratio) meet the minimum, so a token with a different ratio cannot masquerade as a better fill.</li>
          <li><b>Legs trust balance deltas only.</b> Swap calldata is untrusted: targets are allowlisted, approvals are per-leg and reset to zero, results are measured by balance changes.</li>
          <li><b>Agents never receive assets.</b> Recipient is hardcoded to the owner; caps and expiry are enforced onchain; the owner can revoke instantly.</li>
          <li><b>The keeper is bounded.</b> A posted ratio can move at most 5% per post; a bigger jump (a split) pauses buys for that token until the admin confirms. Stale data blocks buys, never exits.</li>
        </ul>
      </section>


      <section className="text-sm">
        <h2 className="text-lg font-medium">Disclaimers</h2>
        <p className="muted mt-2">Not investment advice. Tokenized stock availability depends on your jurisdiction and each issuer&apos;s terms; you are responsible for your eligibility. Parallax does not geolocate users. Basket tokens are vault receipts, not an investment product or a token launch.</p>
        <p className="muted mt-2">
          Source, tests, threat model and the full recon of every token contract: <A href="https://github.com/Adityaakr/parallax">github.com/Adityaakr/parallax</A>.
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
