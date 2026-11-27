// Takes the baseline screenshots of every main screen against tests/parity/mock-api.mjs.
// Usage: node tests/parity/shoot.mjs <outDir>   (web dev server on :5173 proxied to the mock on :8799)
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2] ?? 'docs/parity';
const base = process.env.APP_URL ?? 'http://localhost:5173';
const mock = process.env.MOCK_URL ?? 'http://127.0.0.1:8799';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
setTimeout(() => { console.log('GLOBAL TIMEOUT after 180s'); process.exit(2); }, 180_000);
const failures = [];

async function page(scheme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
  // No network in a screenshot run: app logos come from a stub, anything else off this machine is refused.
  // (Otherwise a slow logo server changes the picture from run to run.)
  await ctx.route((url) => !['localhost', '127.0.0.1'].includes(url.hostname), (route) => (
    route.request().resourceType() === 'image'
      ? route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" rx="8" fill="#6b4fbb"/></svg>' })
      : route.abort()
  ));
  const p = await ctx.newPage();
  p.setDefaultTimeout(15000);
  p.on('console', (m) => m.type() === 'error' && console.log('console.error:', m.text().slice(0, 200)));
  p.on('requestfailed', (r) => console.log('requestfailed:', r.url().slice(0, 120)));
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
  console.log('start', scheme);
  const p = await page(scheme);
  console.log('goto', scheme);
  await p.goto(`${base}/?fixtures=idle`, { waitUntil: 'domcontentloaded' });
  await p.getByLabel('Search').first().waitFor({ timeout: 20000 });
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(2000); // first paint is still settling for a moment; later shots were already stable
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
await so.goto(base, { waitUntil: 'domcontentloaded' });
await so.waitForTimeout(1500);
await shot(so, 'sign-in');
await fetch(`${mock}/__signed-in`);

// browser.close() can hang on the open event stream; the screenshots are already on disk.
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
if (failures.length) console.log('STEPS FAILED:\n' + failures.join('\n'));
process.exit(failures.length ? 1 : 0);
