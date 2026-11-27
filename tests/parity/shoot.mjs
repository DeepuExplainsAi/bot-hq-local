// Takes the baseline screenshots of every main screen against tests/parity/mock-api.mjs.
// Usage: node tests/parity/shoot.mjs <outDir>   (web dev server on :5173 proxied to the mock on :8799)
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] ?? 'docs/parity';
const base = process.env.APP_URL ?? 'http://localhost:5173';
const mock = process.env.MOCK_URL ?? 'http://127.0.0.1:8799';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const failures = [];

async function page(scheme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
  return p;
}
async function shot(p, name) {
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/${name}.png`, animations: 'disabled' });
  console.log('shot', name);
}
/** Run one step; a missing control is recorded, the rest still run. */
async function step(name, fn) {
  try { await fn(); } catch (e) { failures.push(`${name}: ${String(e.message).split('\n')[0]}`); }
}

for (const scheme of ['light', 'dark']) {
  await fetch(`${mock}/__signed-in`);
  const p = await page(scheme);
  await p.goto(`${base}/?fixtures=idle`);
  await p.getByLabel('Search').first().waitFor({ timeout: 20000 });
  await shot(p, `chat-${scheme}`);
  await step('search', async () => { await p.getByLabel('Search').first().click(); await shot(p, `search-${scheme}`); await p.keyboard.press('Escape'); });
  await step('new-bot', async () => { await p.getByLabel('New Bot').first().click(); await shot(p, `new-bot-${scheme}`); await p.keyboard.press('Escape'); });
  await step('connect-apps', async () => { await p.getByLabel('Connect apps').first().click(); await shot(p, `connect-apps-${scheme}`); await p.keyboard.press('Escape'); });
  await step('bot-settings', async () => { await p.getByLabel('Bot settings').first().click(); await shot(p, `bot-settings-${scheme}`); await p.keyboard.press('Escape'); });
  await step('details-hidden', async () => { await p.getByLabel('Close details').first().click(); await shot(p, `details-hidden-${scheme}`); });
  await p.context().close();
}

// Signed-out page.
await fetch(`${mock}/__signed-out`);
const so = await page('light');
await so.goto(base);
await so.waitForTimeout(1500);
await shot(so, 'sign-in');
await fetch(`${mock}/__signed-in`);

await browser.close();
if (failures.length) { console.log('STEPS FAILED:\n' + failures.join('\n')); process.exitCode = 1; }
