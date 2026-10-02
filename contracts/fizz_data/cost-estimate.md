# Cost Estimate

Model: **sonnet** ($3.00/M input, $15.00/M output)
Mode: **automatic**
Selected contracts: **4**
Selected functions: **24** — scale 1x (medium)

| Stage                              | Count | Input    | Output  | Cost     |
|------------------------------------|-------|----------|---------|----------|
| Protocol Analyzer (conditional)    |     1 |      50k |      8k |    $0.27 |
| Discovery agents                   |     5 |     400k |     60k |    $2.10 |
| Synthesizer                        |     1 |      50k |     12k |    $0.33 |
| Implementers                       |     2 |     120k |     30k |    $0.81 |
| Report Writer                      |     1 |      30k |      8k |    $0.21 |
| Orchestrator overhead              |     1 |     250k |     40k |    $1.35 |
| TOTAL                              |       |     900k |    158k |    $5.07 |

**Estimated total: $5.07** — expected range $3.55 – $7.61

These numbers are Anthropic list-price estimates for the subagents and a rough orchestrator overhead share. Actual cost varies with: coverage-iteration cycles (Step 8), re-runs after compile errors, handler complexity, whether x-ray skipped the Protocol Analyzer, and prompt-cache hit rate. Treat this as a ballpark, not a commitment.
