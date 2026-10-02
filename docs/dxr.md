# Developer Experience Report (to be written by the team: human-written, required by the hackathon)

The organizers state that perfunctory or AI-generated reports are not accepted. This file is a **structured outline with pointers only**; write the report in your own words from the sources below.

Required sections (from the official page): onboarding timeline and friction points · specific documentation errors with locations · API pitfalls and edge cases · AI stack feedback (Wallet Skills / Agentic Wallet / CLI) · tokenized-stock-specific observations · redesign suggestions · requested capabilities.

Raw material:
- `docs/submission.md` → "Friction log" (WAF-gated docs, SDK models as the real spec, `/build` prefix in the pre-hash, RFQ-only Ondo routing, ERC-8056 discovery, pruned public RPCs, push-feed latency, gas vs premium at small clips).
- `docs/recon.md` §5 and §8 (what could and could not be verified without an API key).
- `docs/decisions.md` (every non-obvious choice and why).
- Requested capabilities worth listing: an `rwa/tokens` field for "contract-executable venues"; EIP-1271 support in the RFQ settlement so vaults can consume Ondo liquidity; attestation dates as machine-readable timestamps (not just report URLs); a `recipient` parameter in Build Swap Transaction for contract callers; published pool depth per representation.
