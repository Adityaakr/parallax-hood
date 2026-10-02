/**
 * The main journey in a real browser, against the local mocks chain: the eligibility gate, the network label,
 * connecting a wallet, buying a stock, depositing into the index vault and redeeming in kind.
 *
 * The wallet is an EIP-6963 provider injected into the page. It has no key in the browser: every request is
 * handed to this process, which signs with the local dev key or forwards the read to anvil. So the app runs its
 * real connect flow (Privy, wagmi) and its real transaction path, and nothing is stubbed on the app's side.
 *
 * Needs: `pnpm mocks:up`, a resolver on CHAIN_ID=1337, and the web app pointed at it.
 *   BASE=http://127.0.0.1:3200 pnpm --filter @parallax-hood/scripts e2e:browser
 *   SHOTS=/some/dir …   also writes a screenshot per step
 */
import { chromium, type Page } from "playwright";
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { localMocks } from "@parallax-hood/sdk";

const BASE = process.env.BASE ?? "http://127.0.0.1:3200";
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8648";
const RESOLVER = process.env.RESOLVER ?? "http://127.0.0.1:4100";
const SHOTS = process.env.SHOTS;
const pk = (process.env.E2E_PRIVATE_KEY ?? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d96d4fd05f9") as Hex;
const account = privateKeyToAccount(pk);
const pub = createPublicClient({ chain: localMocks, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: localMocks, transport: http(RPC) });
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const health = (await (await fetch(`${RESOLVER}/health`)).json()) as { chainId: number; deployment: { usdg: Address; mocks: Record<string, Address>; baskets: Record<string, Address> } };
if (health.chainId !== 1337) throw new Error(`the resolver at ${RESOLVER} is on chain ${health.chainId}; this test only runs against the local mocks chain`);
const { usdg, mocks, baskets } = health.deployment;
const bal = (token: Address) => pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [account.address] });

/** What the injected provider asks this process to do. Signing happens here; reads go to anvil. */
async function rpc(method: string, params: unknown[]): Promise<unknown> {
  switch (method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [account.address];
    case "eth_chainId":
      return "0x539";
    case "net_version":
      return "1337";
    case "wallet_switchEthereumChain":
    case "wallet_addEthereumChain":
      return null;
    case "wallet_requestPermissions":
    case "wallet_getPermissions":
      return [{ parentCapability: "eth_accounts" }];
    case "personal_sign":
      return account.signMessage({ message: { raw: params[0] as Hex } });
    case "eth_signTypedData_v4":
      return account.signTypedData(JSON.parse(params[1] as string));
    case "eth_sendTransaction": {
      const tx = params[0] as { to: Address; data?: Hex; value?: Hex; gas?: Hex };
      return wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n, gas: tx.gas ? BigInt(tx.gas) : undefined });
    }
    default:
      return pub.request({ method: method as never, params: params as never });
  }
}

const steps: { name: string; ok: boolean; detail: string }[] = [];
let n = 0;
async function step(page: Page, name: string, fn: () => Promise<string>) {
  try {
    const detail = await fn();
    steps.push({ name, ok: true, detail });
    console.log(`PASS  ${name}: ${detail}`);
  } catch (e) {
    steps.push({ name, ok: false, detail: String((e as Error).message).split("\n")[0]!.slice(0, 300) });
    console.log(`FAIL  ${name}: ${steps.at(-1)!.detail}`);
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, "0")}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`, fullPage: false }).catch(() => {});
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.exposeFunction("__parallaxE2eRpc", (method: string, params: unknown[]) => rpc(method, params ?? []));
// A string, not a function: tsx rewrites named inner functions with a helper the page does not have.
await context.addInitScript({ content: `(() => {
  const listeners = {};
  const provider = {
    request: ({ method, params }) => window.__parallaxE2eRpc(method, params || []),
    on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return provider; },
    removeListener: (ev, fn) => { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); return provider; },
  };
  window.ethereum = provider;
  const icon = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#111"/></svg>');
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "7c1b3d1e-5a0f-4c0b-9a51-e2e0000000e2", name: "Parallax E2E Wallet", icon, rdns: "dev.parallax.e2e" }, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();` });
/** Wait until the button with exactly this label (or matching this pattern) is enabled. */
const enabled = (page: Page, label: string, timeout = 60_000) =>
  page.waitForFunction(`(() => { const re = new RegExp(${JSON.stringify("^" + "LABEL" + "$")}.replace("LABEL", ${JSON.stringify(label)})); const b = [...document.querySelectorAll("button")].find((x) => re.test((x.textContent || "").trim())); return Boolean(b && !b.disabled); })()`, undefined, { timeout });
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));

await step(page, "eligibility gate", async () => {
  await page.goto(`${BASE}/stocks`, { waitUntil: "domcontentloaded" });
  const gate = page.getByRole("button", { name: "I confirm, continue" });
  await gate.waitFor({ timeout: 30_000 });
  const text = await page.locator("body").innerText();
  if (!/U\.S\. persons/.test(text)) throw new Error("the gate does not mention U.S. persons");
  await gate.click();
  await gate.waitFor({ state: "detached", timeout: 10_000 });
  return "shown before anything else, names U.S. persons, dismissed on confirmation";
});

await step(page, "network label", async () => {
  await page.getByText("NVDA").first().waitFor({ timeout: 30_000 });
  const text = await page.locator("body").innerText();
  if (!/Local mocks/i.test(text)) throw new Error("the network name is not on screen");
  if (!/\bLOCAL\b/i.test(text)) throw new Error("the network kind is not on screen");
  if (!/mock/i.test(text) || !/stock tokens/i.test(text)) throw new Error("the page does not say what is mocked");
  return "names the network, its kind and what is mocked";
});

await step(page, "connect wallet", async () => {
  const short = new RegExp(account.address.slice(0, 6), "i");
  const connected = page.getByText(short).first();
  const connect = page.getByRole("button", { name: /^Connect wallet/ }).first();
  // wagmi discovers the announced provider and reconnects to it by itself, since it already answers
  // eth_accounts. The Privy modal is only walked through if that has not happened once the page settles.
  let how = "through provider discovery (the Privy modal was not needed)";
  for (const deadline = Date.now() + 60_000; Date.now() < deadline; ) {
    if (await connected.isVisible().catch(() => false)) break;
    if (await connect.isEnabled().catch(() => false)) {
      // Privy either lists the announced wallet to pick, or signs in straight away with the one it detected
      await connect.click().catch(() => {});
      const entry = page.getByText("Parallax E2E Wallet").first();
      if (await entry.isVisible({ timeout: 5_000 }).catch(() => false)) await entry.click().catch(() => {});
      how = "through Privy's sign-in";
    }
    await page.waitForTimeout(1_000);
  }
  await connected.waitFor({ timeout: 5_000 });
  return `${account.address} connected ${how}`;
});

await step(page, "buy 100 USDG of NVDA", async () => {
  const before = await bal(mocks.NVDA!);
  const usdgBefore = await bal(usdg);
  await page.goto(`${BASE}/buy/NVDA`, { waitUntil: "domcontentloaded" });
  const amount = page.getByLabel(/amount/i).first();
  await amount.waitFor({ timeout: 30_000 });
  // A value typed while the page is still hydrating is put back to the default, so type until it holds and the
  // total on screen is the one this step expects. Nothing is signed before that.
  const total = page.locator(".fee-row", { hasText: "Total USDG incl. fee" }).getByText("100.5", { exact: true });
  for (let i = 0; ; i++) {
    await amount.fill("100");
    const shown = await total.waitFor({ timeout: 8_000 }).then(() => true, () => false);
    if (shown && (await amount.inputValue()) === "100") break;
    if (i === 5) throw new Error(`the amount box holds ${await amount.inputValue()} and the total never read 100.5`);
  }
  const buy = page.getByRole("button", { name: "Buy NVDA" });
  await buy.waitFor({ timeout: 30_000 });
  await enabled(page, "Buy NVDA");
  await buy.click();
  const ack = page.getByRole("button", { name: "I understand, continue" });
  if (await ack.isVisible({ timeout: 3_000 }).catch(() => false)) await ack.click();
  await page.getByText(/^Sent:/).first().waitFor({ timeout: 60_000 });
  const got = (await bal(mocks.NVDA!)) - before;
  const spent = usdgBefore - (await bal(usdg));
  if (got <= 0n) throw new Error("no NVDA arrived");
  // 100 USDG plus the 50 bps fee, in 6 decimals; about 0.43 tokens at about 231 dollars
  if (spent !== 100_500_000n) throw new Error(`spent ${spent} raw USDG, expected 100500000`);
  const tokens = Number(got) / 1e18;
  if (tokens < 0.4 || tokens > 0.46) throw new Error(`received ${tokens} NVDA for 100 USDG`);
  return `spent 100.50 USDG, received ${tokens.toFixed(6)} NVDA`;
});

await step(page, "invest 50 USDG in pxMAG7", async () => {
  const before = await bal(baskets.pxMAG7!);
  await page.goto(`${BASE}/baskets/pxMAG7`, { waitUntil: "domcontentloaded" });
  const amount = page.locator("input.big-num").first();
  await amount.waitFor({ timeout: 30_000 });
  await amount.fill("50");
  const invest = page.getByRole("button", { name: "Invest $50" });
  await invest.waitFor({ timeout: 45_000 });
  await enabled(page, "Invest \\$50");
  await invest.click();
  const ack = page.getByRole("button", { name: "I understand, continue" });
  if (await ack.isVisible({ timeout: 3_000 }).catch(() => false)) await ack.click();
  await page.getByText(/^Sent:/).first().waitFor({ timeout: 60_000 });
  const units = Number((await bal(baskets.pxMAG7!)) - before) / 1e18;
  if (units < 0.45 || units > 0.5) throw new Error(`minted ${units} units for a 50 USDG budget`);
  return `minted ${units.toFixed(4)} units, seven stocks bought in one transaction`;
});

await step(page, "redeem in kind", async () => {
  const before = await bal(baskets.pxMAG7!);
  const tslaBefore = await bal(mocks.TSLA!);
  await page.getByRole("button", { name: "Redeem", exact: true }).click();
  const units = page.getByLabel(/units/i).first();
  await units.waitFor({ timeout: 15_000 });
  await units.fill("0.2");
  await page.getByText(/in kind/i).first().click();
  const redeem = page.getByRole("button", { name: /^Redeem 0\.2 in kind$/ });
  await redeem.waitFor({ timeout: 30_000 });
  await enabled(page, "Redeem 0\\.2 in kind");
  await redeem.click();
  await page.getByText(/^Sent:/).first().waitFor({ timeout: 60_000 });
  const burned = Number(before - (await bal(baskets.pxMAG7!))) / 1e18;
  if (Math.abs(burned - 0.2) > 1e-9) throw new Error(`burned ${burned} units`);
  if ((await bal(mocks.TSLA!)) <= tslaBefore) throw new Error("no TSLA came back");
  return "0.2 units burned, the stock tokens themselves returned";
});

await step(page, "portfolio and activity", async () => {
  await page.goto(`${BASE}/portfolio`, { waitUntil: "domcontentloaded" });
  await page.getByText("pxMAG7").first().waitFor({ timeout: 30_000 });
  await page.getByText("NVDA").first().waitFor({ timeout: 30_000 });
  await page.goto(`${BASE}/receipts`, { waitUntil: "domcontentloaded" });
  await page.getByText(/mint/i).first().waitFor({ timeout: 45_000 });
  return "positions listed in the portfolio, receipts in the activity log";
});

await browser.close();
const failed = steps.filter((s) => !s.ok);
if (errors.length) console.log(`\npage errors:\n  ${[...new Set(errors)].slice(0, 5).join("\n  ")}`);
console.log(failed.length ? `\n${failed.length} of ${steps.length} steps failed` : `\nPASS: ${steps.length} steps in a real browser against chain 1337`);
process.exit(failed.length ? 1 : 0);
