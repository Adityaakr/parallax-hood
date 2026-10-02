/**
 * The Parallax work hook. A funded ERC-8183 job or a paid x402 request reaches `runWork` with the buyer's
 * task text. Two kinds of task exist:
 *
 *   1. an EXECUTION — "invest $100 into pxMAG7 with mandate 3", "buy $50 of NVDA under mandate 3". The
 *      buyer is the wallet owner who granted this agent an AgentMandate. Fixed code plans the action through
 *      the resolver, re-checks the mandate's caps/allowlist/expiry, signs the mandate call with the agent
 *      wallet and broadcasts it. The LLM never touches this path; afterwards it may only *describe* what
 *      happened. Money moves owner → vault/router → owner; the agent is never a recipient.
 *   2. RESEARCH — anything else ("which index has the best 1-year return?", "compare NVDA issuers"). The LLM
 *      answers with the read-only Parallax tools.
 *
 * The parser is deliberately strict: an execution runs only when an index/ticker, a dollar amount and a
 * mandate id are all present. Anything ambiguous is treated as research, never as a trade.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { executePlan, planBuy, planInvest, type Plan } from "./client.js";

/**
 * Executions are side effects: a job whose deliverable failed to publish must not invest twice when the
 * runtime's sweep retries it. Every execution is recorded under its session (the ERC-8183 job id, or the
 * x402 request) and a repeat returns the recorded deliverable. The ledger lives beside the keystore, outside
 * the deploy artifact; on a fresh runtime the chain's MandateSpend events remain the source of truth.
 */
const LEDGER = process.env.PARALLAX_JOB_LEDGER ?? resolve(process.cwd(), "../../.studio/parallax-jobs.json");
const ledger: Record<string, string> = (() => {
  try { return existsSync(LEDGER) ? (JSON.parse(readFileSync(LEDGER, "utf8")) as Record<string, string>) : {}; } catch { return {}; }
})();
function remember(session: string, deliverable: string) {
  ledger[session] = deliverable;
  try { mkdirSync(dirname(LEDGER), { recursive: true }); writeFileSync(LEDGER, JSON.stringify(ledger, null, 2)); } catch { /* memory still holds it for this process */ }
}

/** What this seller is: Parallax's execution and index agent for tokenized stocks on BNB Chain. */
export const PARALLAX_SYSTEM =
  "You are Parallax, a best-execution and index agent for tokenized stocks on BNB Chain. The runtime has " +
  "already authorized this task through its configured commerce rail; complete it now and do not ask for a " +
  "job ID or additional payment. Use the parallax_* tools for every figure: prices, returns, routes, indices, " +
  "mandates and receipts come from them, never from memory. Quote costs per underlying share and premiums to " +
  "the Chainlink reference in bps. You cannot execute trades yourself: an investment or purchase is executed " +
  "by fixed code only when the task names an index or ticker, a dollar amount and a mandate id; otherwise " +
  "explain what you would do and what the owner must grant. Be concrete and concise.";

export type RunWork = (prompt: string, opts: { sessionId: string; abortSignal?: AbortSignal }) => Promise<string>;

export type ParallaxTask =
  | { kind: "invest"; index: string; usd: string; mandateId: bigint }
  | { kind: "buy"; ticker: string; usd: string; mandateId: bigint }
  | { kind: "research" };

const AMOUNT = String.raw`\$?\s*(\d+(?:\.\d+)?)\s*(?:USDT?|usdt?|usd|dollars?)?`;
const STOPWORDS = new Set(["OF", "IN", "INTO", "AT", "THE", "USD", "USDT", "AND", "FOR", "TO"]);

/** Structured terms first (an ERC-8183 job carries `{task, terms}`), then plain English. */
export function parseTask(prompt: string): ParallaxTask {
  const json = firstJsonObject(prompt);
  const terms = (json?.terms ?? json) as Record<string, unknown> | undefined;
  const fromTerms = terms ? fromStructured(terms) : null;
  if (fromTerms) return fromTerms;
  const text = typeof json?.task === "string" ? `${json.task}\n${prompt}` : prompt;
  const mandate = /mandate\s*(?:id)?\s*#?\s*(\d+)/i.exec(text);
  if (!mandate) return { kind: "research" };
  const invest = new RegExp(String.raw`(?:invest|put|allocate|mint)\s+${AMOUNT}\s+(?:of\s+)?(?:in|into)\s+(px[a-z0-9]+)`, "i").exec(text);
  if (invest) return { kind: "invest", usd: invest[1]!, index: invest[2]!, mandateId: BigInt(mandate[1]!) };
  // the ticker must be written as one (upper case, not a preposition), so "buy $10 of pxMAG7" is not a buy of "OF"
  const buy = new RegExp(String.raw`[Bb]uy\s+${AMOUNT}\s+(?:(?:worth\s+)?of\s+)?([A-Z]{1,6})\b`).exec(text);
  if (buy && !STOPWORDS.has(buy[2]!)) return { kind: "buy", usd: buy[1]!, ticker: buy[2]!, mandateId: BigInt(mandate[1]!) };
  return { kind: "research" };
}

function fromStructured(t: Record<string, unknown>): ParallaxTask | null {
  const mandateId = t.mandate_id ?? t.mandateId;
  const usd = t.usd ?? t.usd_amount ?? t.amount_usd;
  if (mandateId === undefined || usd === undefined) return null;
  const action = String(t.action ?? t.kind ?? "").toLowerCase();
  if ((action === "invest" || t.index) && typeof t.index === "string") return { kind: "invest", index: t.index, usd: String(usd), mandateId: BigInt(String(mandateId)) };
  if ((action === "buy" || t.ticker) && typeof t.ticker === "string") return { kind: "buy", ticker: t.ticker.toUpperCase(), usd: String(usd), mandateId: BigInt(String(mandateId)) };
  return null;
}

function firstJsonObject(s: string): Record<string, any> | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  // walk to the matching brace so a JSON blob embedded in prose parses
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) {
      try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

/** Free-tier models sometimes emit their reasoning before the answer; a deliverable carries only the answer. */
export function stripThinking(text: string): string {
  const closed = text.lastIndexOf("</think>");
  const out = closed >= 0 ? text.slice(closed + "</think>".length) : text.replace(/<think>[\s\S]*$/i, "");
  return out.trim();
}

/** Wrap the scaffold's LLM work: executions run as fixed code, research goes to the model with Parallax tools. */
export function parallaxWork(llm: RunWork): RunWork {
  const answer: RunWork = async (prompt, opts) => stripThinking(await llm(prompt, opts));
  return async (prompt, opts) => {
    const task = parseTask(prompt);
    if (task.kind === "research") return answer(prompt, opts);
    // an ERC-8183 job id is a durable session; x402 requests are one-shot and never retried by the runtime
    const session = /^\d+$/.test(opts.sessionId) ? `job:${opts.sessionId}` : null;
    if (session && ledger[session]) return ledger[session]!;

    const plan: Plan = task.kind === "invest" ? await planInvest({ mandateId: task.mandateId, index: task.index, usd: task.usd }) : await planBuy({ mandateId: task.mandateId, ticker: task.ticker, usd: task.usd });
    const done = await executePlan(plan);
    const facts = {
      action: task.kind, mandateId: plan.mandateId.toString(), owner: plan.owner, agent: "mandate agent (this runtime)", mandateContract: plan.to,
      authorizedUsdt: (Number(plan.authorizedUsdt / 10n ** 12n) / 1e6).toFixed(2), quoteHash: plan.quoteHash, ...plan.summary, ...done,
    };
    let explanation = "";
    try {
      explanation = await answer(
        "You executed the following on behalf of the mandate owner; the transaction is already confirmed onchain. In at most 120 words, explain what was bought, from which issuer and why, what it cost against the reference price, and where the assets went (always the owner). Do not invent figures; use only these facts:\n" + JSON.stringify(facts),
        opts,
      );
    } catch {
      /* the deliverable is the facts; prose is a courtesy */
    }
    const deliverable = `# Parallax ${task.kind === "invest" ? "index investment" : "best-execution buy"} — executed\n\n${explanation ? explanation + "\n\n" : ""}\`\`\`json\n${JSON.stringify(facts, null, 2)}\n\`\`\`\n`;
    if (session) remember(session, deliverable);
    return deliverable;
  };
}
