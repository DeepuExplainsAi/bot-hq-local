// Part 6 verification: the desktop-mode server on a fresh data folder, then restarted on the same folder.
// Needs `npm run build -w server`. Runs the real server (no cloud keys, fake `hermes`, fake bot browser) and fails
// on any connection that leaves this machine. Usage: node tests/local/verify.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
const require = createRequire(import.meta.url);
const { rfbProbe } = require('./rfb-client.cjs');
const { signInUrl, EMAIL } = require('../../desktop/localauth.cjs');

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const ENTRY = path.join(ROOT, 'server/dist/index.js');
if (!fs.existsSync(ENTRY)) throw new Error('server/dist/index.js is missing: run `npm run build -w server` first');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bothq-verify-'));
const DATA = path.join(TMP, 'appdata'); // stays between the two starts: that is the point
const HERMES = path.join(TMP, 'hermes');
fs.writeFileSync(HERMES, `#!/bin/sh\nexec "${process.execPath}" "${path.join(ROOT, 'tests/local/fake-hermes.mjs')}" "$@"\n`, { mode: 0o755 });

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});
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
async function boot() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const proc = spawn(process.execPath, ['--import', path.join(ROOT, 'tests/no-outbound.mjs'), ENTRY], {
    cwd: TMP,
    env: {
      PATH: process.env.PATH, HOME: TMP, BOTHQ_LOCAL: '1', BOTHQ_DATA: DATA,
      PORT: String(port), APP_URL: base, SERVER_URL: base, MCP_BASE_URL: base,
      HERMES_BIN: HERMES, ENGINE_PORT_BASE: String(await freePort()),
      BOTHQ_BROWSER_CMD: JSON.stringify({ exe: process.execPath, args: [path.join(ROOT, 'tests/local/fake-browser.mjs')] }),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  proc.stdout.on('data', (d) => process.stdout.write(`  [server] ${d}`));
  proc.stderr.on('data', (d) => { stderr += d; process.stdout.write(`  [server!] ${d}`); });
  const exited = new Promise((r) => proc.once('exit', (code) => r(code)));
  await until('the server', async () => (await fetch(`${base}/api/health`)).ok);
  const r = await fetch(await signInUrl(DATA, base), { redirect: 'manual' });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const api = async (method, url, body) => {
    const x = await fetch(`${base}${url}`, { method, headers: { cookie, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: x.status, json: await x.json().catch(() => null) };
  };
  const quit = async () => { proc.send('quit'); return Promise.race([exited, sleep(15_000).then(() => 'timeout')]); };
  return { base, cookie, api, proc, quit };
}
const rowsOf = async (s, bot) => (await s.api('GET', `/api/bots/${bot}/rows`)).json?.rows ?? [];
const textOf = (row) => row.body?.text ?? '';
const count = (rows, pred) => rows.filter(pred).length;
const isRun = (row) => row.body?.event === 'routine-run';

let s1;
let bot;
let runsBefore = 0;
try {
  await step('1. fresh install: the app starts on an empty data folder, signed in as the local user', async () => {
    ok(!fs.existsSync(DATA), 'data folder existed before the first start');
    s1 = await boot();
    const me = await s1.api('GET', '/api/auth/me');
    ok(me.json?.user?.email === EMAIL, `me: ${JSON.stringify(me.json)}`);
    ok(fs.existsSync(path.join(DATA, 'bothq.db')), 'no database in the data folder');
  });

  await step('2. create a bot', async () => {
    const r = await s1.api('POST', '/api/bots', { name: 'Doug' });
    ok(r.status === 200 && r.json?.bot?.id, `HTTP ${r.status}`);
    bot = r.json.bot.id;
    ok((await s1.api('GET', '/api/bots')).json.bots.some((b) => b.id === bot), 'bot not listed');
  });

  await step('3. chat: a message goes through the gateway and the streamed answer is stored', async () => {
    ok((await s1.api('POST', `/api/bots/${bot}/messages`, { text: 'hello there' })).status === 200, 'send failed');
    await until('the answer', async () => (await rowsOf(s1, bot)).some((r) => r.body?.role === 'assistant' && textOf(r).includes('Echo: hello there')));
  });

  await step('4. the bot browser screen shows in the viewer (RFB, Tight JPEG)', async () => {
    const ws = new WebSocket(`${s1.base.replace('http', 'ws')}/api/bots/${bot}/screen?mode=watch`, ['binary'], { headers: { cookie: s1.cookie } });
    const r = await rfbProbe(ws);
    ws.close();
    ok(r.encoding === 7 && r.jpegStart[0] === 0xff && r.jpegStart[1] === 0xd8, JSON.stringify(r));
  });

  await step('5. routines: the bot creates one through its tools and the scheduler runs it', async () => {
    await s1.api('POST', `/api/bots/${bot}/messages`, { text: 'CREATE_ROUTINE tick 1' });
    const list = await until('the routine', async () => { const l = (await s1.api('GET', `/api/bots/${bot}/routines`)).json.routines; return l.length ? l : null; });
    ok(list[0].name === 'tick' && list[0].enabled, JSON.stringify(list[0]));
    await until('the scheduled run', async () => (await rowsOf(s1, bot)).some((r) => textOf(r).includes('Echo: [Routine "tick" is running now')));
    ok((await s1.api('GET', `/api/bots/${bot}/routines`)).json.routines[0].lastRunAt, 'last run not recorded');
  });

  await step('6. restart keeps the data (bot, chat, routine) and the scheduler runs the routine again', async () => {
    const before = await rowsOf(s1, bot);
    runsBefore = count(before, isRun);
    ok(await s1.quit() === 0, 'first server did not quit cleanly');
    const s2 = await boot();
    ok((await s2.api('GET', '/api/bots')).json.bots.some((b) => b.id === bot), 'bot is gone');
    const after = await rowsOf(s2, bot);
    ok(after.some((r) => textOf(r).includes('Echo: hello there')), 'chat history is gone');
    const l = (await s2.api('GET', `/api/bots/${bot}/routines`)).json.routines;
    ok(l.length === 1 && l[0].name === 'tick', 'routine is gone');
    await until('a run after the restart', async () => count(await rowsOf(s2, bot), isRun) > runsBefore);
    ok(await s2.quit() === 0, 'second server did not quit cleanly');
  });

  await step('7. no connection left this machine (nothing to Orgo, Google, Composio or xAI)', async () => {
    ok(!stderr.includes('[no-outbound]'), stderr.split('\n').filter((l) => l.includes('[no-outbound]')).join('; '));
  });
} finally {
  s1?.proc.kill('SIGKILL');
  fs.rmSync(TMP, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
