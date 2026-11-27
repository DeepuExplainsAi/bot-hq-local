// Real Hermes, no model: the first-run install from desktop/hermes.cjs (uv -> Python -> Hermes, into a temp app-data
// folder), then a gateway for one bot started the way server/src/engine.ts starts it (same command, environment and
// files), and its /health must answer. No API key, no model call. Usage: node tests/local/hermes-real.mjs
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { ensureHermes } = createRequire(import.meta.url)('../../desktop/hermes.cjs');

const win = process.platform === 'win32';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bothq-real-'));
const logFile = path.join(root, 'engines', 'bot1', 'logs', 'gateway.out.log');
const t0 = Date.now();
const secs = () => `${Math.round((Date.now() - t0) / 1000)}s`;
let child;
let code = 1;
try {
  const bin = await ensureHermes(path.join(root, 'hermes'), (t) => console.log(`[${secs()}] ${t}`));
  console.log(`[${secs()}] hermes at ${bin}`);

  const home = path.join(root, 'engines', 'bot1');
  for (const d of ['logs', 'locks', 'workspace']) fs.mkdirSync(path.join(home, d), { recursive: true });
  const port = 18900 + Math.floor(Math.random() * 500);
  const key = 'k'.repeat(32);
  fs.writeFileSync(path.join(home, '.env'), `API_SERVER_ENABLED=true\nAPI_SERVER_KEY=${key}\nAPI_SERVER_PORT=${port}\nAPI_SERVER_HOST=127.0.0.1\n`);
  fs.writeFileSync(path.join(home, 'config.yaml'), 'agent:\n  reasoning_effort: medium\nterminal:\n  cwd: ' + JSON.stringify(path.join(home, 'workspace')) + '\n');

  const fd = fs.openSync(logFile, 'a');
  child = spawn(bin, ['gateway', 'run', '--no-supervise'], {
    cwd: home, detached: !win, windowsHide: true, stdio: ['ignore', fd, fd],
    env: {
      PATH: [path.dirname(bin), process.env.PATH].join(path.delimiter),
      HOME: process.env.HOME ?? os.homedir(), USER: process.env.USER ?? os.userInfo().username, LANG: process.env.LANG ?? 'C.UTF-8',
      ...(win ? Object.fromEntries(['SystemRoot', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'ComSpec', 'PATHEXT', 'PYTHONUTF8'].filter((k) => process.env[k]).map((k) => [k, process.env[k]])) : {}),
      HERMES_HOME: home, HERMES_GATEWAY_LOCK_DIR: path.join(home, 'locks'), BH_HOME: path.join(home, 'browser-harness'),
    },
  });
  let exited = null;
  child.once('error', (e) => { exited = `could not run ${bin}: ${e.message}`; });
  child.once('exit', (c) => { exited = `gateway exited with code ${c}`; });

  let health = null;
  for (let i = 0; i < 90 && !health && !exited; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) }).then((r) => (r.ok ? r.json() : null), () => null);
  }
  if (!health) throw new Error(exited ?? 'the gateway did not answer /health within 90 s');
  console.log(`[${secs()}] GATEWAY HEALTH OK ${JSON.stringify(health)}`);
  const models = await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { authorization: `Bearer ${key}` } });
  console.log(`[${secs()}] /v1/models with the bot key: HTTP ${models.status}`);
  if (!models.ok) throw new Error(`/v1/models: HTTP ${models.status}`);
  const bad = await fetch(`http://127.0.0.1:${port}/v1/models`, { headers: { authorization: 'Bearer wrong' } });
  if (bad.status !== 401) throw new Error(`wrong key was not refused: HTTP ${bad.status}`);
  if (fs.existsSync(path.join(os.homedir(), '.hermes'))) throw new Error('~/.hermes exists: Hermes wrote outside the app-data folder');
  console.log(`[${secs()}] REAL HERMES OK (health, key check, ~/.hermes untouched)`);
  code = 0;
} catch (e) {
  console.log(`REAL HERMES FAILED: ${e?.message ?? e}`);
  if (fs.existsSync(logFile)) console.log(`--- gateway.out.log (tail)\n${fs.readFileSync(logFile, 'utf8').split('\n').slice(-40).join('\n')}`);
} finally {
  if (child?.pid) {
    try { win ? execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) : process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  await new Promise((r) => setTimeout(r, 1500));
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }); } catch { /* temp folder; the runner is thrown away */ }
}
process.exit(code);
