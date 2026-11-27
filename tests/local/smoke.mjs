// Desktop-mode smoke test (Part 1a). Needs `npm run build -w server`. Runs the real server with BOTHQ_LOCAL=1,
// no Orgo / Composio / xAI keys, a fake `hermes`, and a guard that fails any connection leaving this machine.
// Usage: node tests/local/smoke.mjs
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
const { rfbProbe } = createRequire(import.meta.url)('./rfb-client.cjs');

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const ENTRY = path.join(ROOT, 'server/dist/index.js');
if (!fs.existsSync(ENTRY)) throw new Error('server/dist/index.js is missing: run `npm run build -w server` first');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bothq-local-'));
const DATA = path.join(TMP, 'appdata');
const HERMES = path.join(TMP, 'hermes');
fs.writeFileSync(HERMES, `#!/bin/sh\nexec "${process.execPath}" "${path.join(ROOT, 'tests/local/fake-hermes.mjs')}" "$@"\n`, { mode: 0o755 });

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});
const PORT = await freePort();
const ENGINE_BASE = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, fn, ms = 30_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
};

const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (e) { results.push({ name, ok: false }); console.log(`FAIL ${name}: ${e?.message ?? e}`); }
};
const ok = (cond, msg) => { if (!cond) throw new Error(msg); };

let stderr = '';
// Only what the desktop shell sets: no cloud keys at all.
const server = spawn(process.execPath, ['--import', path.join(ROOT, 'tests/no-outbound.mjs'), ENTRY], {
  cwd: TMP,
  env: {
    PATH: process.env.PATH, HOME: TMP, BOTHQ_LOCAL: '1', BOTHQ_DATA: DATA,
    PORT: String(PORT), APP_URL: BASE, SERVER_URL: BASE, MCP_BASE_URL: BASE,
    HERMES_BIN: HERMES, ENGINE_PORT_BASE: String(ENGINE_BASE),
    BOTHQ_BROWSER_CMD: JSON.stringify({ exe: process.execPath, args: [path.join(ROOT, 'tests/local/fake-browser.mjs')] }),
  },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
server.stdout.on('data', (d) => process.stdout.write(`  [server] ${d}`));
server.stderr.on('data', (d) => { stderr += d; process.stdout.write(`  [server!] ${d}`); });
const exited = new Promise((r) => server.once('exit', (code) => r(code)));

let cookie = '';
const api = async (method, url, body) => {
  const r = await fetch(`${BASE}${url}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};

try {
  await step('server starts with no cloud keys and answers /api/health', async () => {
    const h = await until('health', async () => { const r = await fetch(`${BASE}/api/health`); return r.ok ? r.json() : null; });
    ok(h.ok === true, 'health not ok');
  });

  await step('listens on 127.0.0.1 only', async () => {
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && !i.internal && i.family === 'IPv4')?.address;
    if (!lan) return; // no other address on this machine: nothing to try
    const reached = await fetch(`http://${lan}:${PORT}/api/health`, { signal: AbortSignal.timeout(2000) }).then(() => true, () => false);
    ok(!reached, `server answered on ${lan}`);
  });

  await step('data lives in BOTHQ_DATA, secret key made and private', async () => {
    ok(fs.existsSync(path.join(DATA, 'bothq.db')), 'no bothq.db in the data folder');
    const key = path.join(DATA, 'secret.key');
    ok(fs.readFileSync(key, 'utf8').trim().length >= 32, 'secret.key too short');
    if (process.platform !== 'win32') ok((fs.statSync(key).mode & 0o077) === 0, 'secret.key is readable by others');
  });

  // Sign-in as the desktop shell does it: the per-install secret opens a one-time link, no sign-in page.
  const { signInUrl, EMAIL } = createRequire(import.meta.url)('../../desktop/localauth.cjs');
  await step('desktop sign-in: the install secret signs in the single local user', async () => {
    const anon = await fetch(`${BASE}/api/bots`);
    ok(anon.status === 401, `API open without a session: HTTP ${anon.status}`);
    const link = await signInUrl(DATA, BASE);
    const r = await fetch(link, { redirect: 'manual' });
    ok(r.status === 302 && r.headers.get('location') === '/', `link: HTTP ${r.status} -> ${r.headers.get('location')}`);
    cookie = r.headers.get('set-cookie').split(';')[0];
    const me = await api('GET', '/api/auth/me');
    ok(me.json?.user?.email === EMAIL, `me: ${JSON.stringify(me.json)}`);
    const again = await fetch(link, { redirect: 'manual' });
    ok(again.status === 410, `link works twice: HTTP ${again.status}`);
  });
  await step('a wrong install key and a forwarded request are refused', async () => {
    const body = JSON.stringify({ email: EMAIL, link: true });
    const bad = await fetch(`${BASE}/api/auth/owner`, { method: 'POST', headers: { authorization: `Bearer ${'0'.repeat(64)}`, 'content-type': 'application/json' }, body });
    ok(bad.status === 403, `wrong key: HTTP ${bad.status}`);
    const secret = fs.readFileSync(path.join(DATA, 'secret.key'), 'utf8').trim();
    const key = crypto.createHmac('sha256', secret).update('owner-login').digest('hex');
    const fwd = await fetch(`${BASE}/api/auth/owner`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'x-forwarded-for': '203.0.113.9', 'content-type': 'application/json' }, body });
    ok(fwd.status === 403, `forwarded request with the right key: HTTP ${fwd.status}`);
  });

  let bot;
  await step('creating a bot starts its own Hermes gateway from the app-data folder', async () => {
    const r = await api('POST', '/api/bots', { name: 'Doug' });
    ok(r.status === 200, `create bot: HTTP ${r.status} ${JSON.stringify(r.json)}`);
    bot = r.json.bot;
    const info = await until('engine ready', async () => { const e = await api('GET', `/api/bots/${bot.id}/engine`); return e.json?.engine?.status === 'ready' ? e.json.engine : null; });
    ok(info.version === 'fake-1', `unexpected version ${info.version}`);
    ok(fs.existsSync(path.join(DATA, 'engines', bot.id, 'config.yaml')), 'no Hermes home under the data folder');
    const cfg = fs.readFileSync(path.join(DATA, 'engines', bot.id, 'config.yaml'), 'utf8');
    ok(cfg.includes(`/mcp/${bot.id}`), 'the hq MCP server is not registered in the bot config');
    const env = fs.readFileSync(path.join(DATA, 'engines', bot.id, '.env'), 'utf8');
    ok(env.includes('API_SERVER_HOST=127.0.0.1'), 'gateway API is not bound to 127.0.0.1');
  });

  await step('the user\'s ~/.hermes is never touched', async () => {
    ok(!fs.existsSync(path.join(TMP, '.hermes')), '~/.hermes was created');
  });

  await step('library files list and download with Node (no bash)', async () => {
    const dir = path.join(DATA, 'files', bot.id);
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'note.txt'), 'hello');
    const l = await api('GET', `/api/bots/${bot.id}/files`);
    ok(l.json?.status === 'ok', `list: ${JSON.stringify(l.json)}`);
    const names = l.json.files.map((f) => `${f.name}:${f.isDir ? 'dir' : f.size}`);
    ok(names.join() === 'sub:dir,note.txt:5', `unexpected listing ${names}`);
    const raw = await fetch(`${BASE}/api/bots/${bot.id}/files/raw?path=note.txt`, { headers: { cookie } });
    ok((await raw.text()) === 'hello', 'download body differs');
  });

  await step('each bot has its own browser (own profile folder, own DevTools port), wired to Hermes', async () => {
    const dirs = fs.readdirSync(path.join(DATA, 'profiles')).filter((d) => fs.existsSync(path.join(DATA, 'profiles', d, 'browser')));
    ok(dirs.length >= 2 && dirs.includes(bot.id), `profile folders: ${dirs}`);
    const ports = dirs.map((d) => fs.readFileSync(path.join(DATA, 'profiles', d, 'cdp-port'), 'utf8'));
    ok(new Set(ports).size === ports.length, `ports shared: ${ports}`);
    const port = fs.readFileSync(path.join(DATA, 'profiles', bot.id, 'cdp-port'), 'utf8');
    const cfg = fs.readFileSync(path.join(DATA, 'engines', bot.id, 'config.yaml'), 'utf8');
    ok(cfg.includes(`cdp_url: http://127.0.0.1:${port}`), 'Hermes config has no cdp_url for this bot');
    const env = fs.readFileSync(path.join(DATA, 'engines', bot.id, '.env'), 'utf8');
    ok(env.includes(`BROWSER_CDP_URL=http://127.0.0.1:${port}`), 'no BROWSER_CDP_URL in the bot .env');
    ok(await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok, () => false), 'the bot browser does not answer');
  });

  const viewer = (mode) => new WebSocket(`ws://127.0.0.1:${PORT}/api/bots/${bot.id}/screen?mode=${mode}`, ['binary'], { headers: { cookie } });
  const inputLog = () => { try { return fs.readFileSync(path.join(DATA, 'profiles', bot.id, 'browser', 'input.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const click = [[5, 1, 0, 10, 0, 20], [5, 0, 0, 10, 0, 20]]; // RFB PointerEvent: left button down, up, at (10,20)
  await step('viewer in watch mode gets the picture as Tight JPEG and its input is dropped', async () => {
    const ws = viewer('watch');
    const r = await rfbProbe(ws, click);
    ws.close();
    ok(r.width === 64 && r.height === 48 && r.rectW === 64 && r.rectH === 48, `size ${JSON.stringify(r)}`);
    ok(r.encoding === 7 && r.ctl === 0x90 && r.jpegStart[0] === 0xff && r.jpegStart[1] === 0xd8, `rect ${JSON.stringify(r)}`);
    ok(!inputLog().some((e) => e.method === 'Input.dispatchMouseEvent'), 'watch mode forwarded a mouse event');
  });
  await step('viewer in control mode drives the browser (click at 10,20)', async () => {
    const ws = viewer('control');
    await rfbProbe(ws, click);
    ws.close();
    const ev = inputLog().filter((e) => e.method === 'Input.dispatchMouseEvent' && e.type !== 'mouseMoved');
    ok(ev.length === 2 && ev[0].type === 'mousePressed' && ev[1].type === 'mouseReleased' && ev[0].x === 10 && ev[0].y === 20 && ev[0].button === 'left', JSON.stringify(ev));
  });
  await step('a viewer with no session is refused', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/bots/${bot.id}/screen?mode=watch`, ['binary']);
    const code = await new Promise((res) => { ws.on('unexpected-response', (_q, r) => res(r.statusCode)); ws.on('open', () => res(200)); ws.on('error', () => {}); });
    ok(code === 401, `HTTP ${code}`);
  });
  await step('the preview screenshot comes from the bot browser', async () => {
    const r = await fetch(`${BASE}/api/bots/${bot.id}/screenshot`, { headers: { cookie } });
    ok(r.status === 200 && r.headers.get('content-type') === 'image/jpeg' && (await r.arrayBuffer()).byteLength > 10, `HTTP ${r.status}`);
  });

  await step('computer reports running without Orgo', async () => {
    const r = await api('GET', '/api/computer');
    ok(r.json?.computer?.status === 'running', `computer: ${JSON.stringify(r.json)}`);
  });

  await step('voice and X search stay off without an xAI key (and send nothing)', async () => {
    const r = await api('POST', '/api/voice/session', { botId: bot.id });
    ok(r.status === 409, `voice session: HTTP ${r.status}`);
    const o = await api('GET', '/api/voice/options');
    ok(o.status === 200 && o.json.voices.length > 0, 'voice options should still list voices');
  });

  await step('a gateway that crashes comes back', async () => {
    const home = path.join(DATA, 'engines', bot.id);
    const url = `http://127.0.0.1:${ENGINE_BASE + 1}`; // the primary bot made at sign-in holds the first port
    const pidOf = async () => {
      const out = fs.readFileSync(path.join(home, 'logs', 'gateway.out.log'), 'utf8').trim().split('\n').filter(Boolean);
      return JSON.parse(out[out.length - 1]).pid;
    };
    const first = await pidOf();
    process.kill(first, 'SIGKILL');
    const second = await until('a new gateway', async () => {
      const up = await fetch(`${url}/health`).then((r) => r.ok, () => false);
      const p = up ? await pidOf() : first;
      return p !== first ? p : null;
    }, 20_000);
    ok(second !== first, 'same pid');
  });

  await step('no connection left this machine', async () => {
    ok(!stderr.includes('[no-outbound]'), stderr.split('\n').filter((l) => l.includes('[no-outbound]')).join('; '));
  });

  await step('deleting a bot stops its browser and removes its profile', async () => {
    const t = (await api('POST', '/api/bots', { name: 'Temp' })).json.bot;
    const portFile = path.join(DATA, 'profiles', t.id, 'cdp-port');
    const port = await until('its browser', async () => { try { const p = fs.readFileSync(portFile, 'utf8'); return (await fetch(`http://127.0.0.1:${p}/json/version`)).ok ? p : null; } catch { return null; } });
    ok((await api('DELETE', `/api/bots/${t.id}`)).status === 200, 'delete failed');
    const up = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
    ok(!up, 'its browser is still running');
    ok(!fs.existsSync(path.join(DATA, 'profiles', t.id)), 'its profile folder is still there');
  });

  await step('quitting the server stops its gateways and browsers', async () => {
    const url = `http://127.0.0.1:${ENGINE_BASE}`;
    const browserPorts = fs.readdirSync(path.join(DATA, 'profiles')).map((d) => fs.readFileSync(path.join(DATA, 'profiles', d, 'cdp-port'), 'utf8'));
    server.send('quit');
    const code = await Promise.race([exited, sleep(15_000).then(() => 'timeout')]);
    ok(code === 0, `server exit: ${code}`);
    const still = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
    ok(!still, 'the gateway is still running after the server quit');
    for (const p of browserPorts) ok(!(await fetch(`http://127.0.0.1:${p}/json/version`, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)), `a bot browser is still running on ${p}`);
  });
} finally {
  server.kill('SIGKILL');
  fs.rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
