/* The parser decides whether money moves; every ambiguity must fall to research. `npx tsx --test src/parallax/work.test.ts` */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTask, stripThinking } from "./work.js";

test("structured ERC-8183 terms execute", () => {
  const p = 'JOB CONTEXT:\n{"task":"invest","terms":{"action":"invest","index":"pxMAG7","usd":"100","mandate_id":"3"}}';
  assert.deepEqual(parseTask(p), { kind: "invest", index: "pxMAG7", usd: "100", mandateId: 3n });
  const b = '{"task":"buy nvda","terms":{"action":"buy","ticker":"nvda","usd":"50","mandate_id":7}}';
  assert.deepEqual(parseTask(b), { kind: "buy", ticker: "NVDA", usd: "50", mandateId: 7n });
});

test("plain English executes only with index/ticker, amount and mandate", () => {
  assert.deepEqual(parseTask("Invest $100 into pxMAG7 with mandate 3"), { kind: "invest", index: "pxMAG7", usd: "100", mandateId: 3n });
  assert.deepEqual(parseTask("put 250 USDT in pxAI under mandate id #12 please"), { kind: "invest", index: "pxAI", usd: "250", mandateId: 12n });
  assert.deepEqual(parseTask("Buy $50 of NVDA at best execution, mandate 4"), { kind: "buy", ticker: "NVDA", usd: "50", mandateId: 4n });
});

test("anything ambiguous is research, never a trade", () => {
  assert.equal(parseTask("Invest $100 into pxMAG7").kind, "research"); // no mandate
  assert.equal(parseTask("Which index has the best 1-year return? mandate 3").kind, "research"); // no amount/index
  assert.equal(parseTask("Should I buy NVDA or AAPL? I have mandate 3 and $500").kind, "research");
  assert.equal(parseTask('{"terms":{"index":"pxMAG7","usd":"100"}}').kind, "research"); // structured but no mandate
  assert.equal(parseTask("buy $10 of pxMAG7 mandate 1").kind, "research"); // an index is not a ticker
});

test("reasoning tags never reach a deliverable", () => {
  assert.equal(stripThinking("Let me think.\n</think>\n\n**pxAI** leads."), "**pxAI** leads.");
  assert.equal(stripThinking("<think>partial"), "");
  assert.equal(stripThinking("plain answer"), "plain answer");
});
