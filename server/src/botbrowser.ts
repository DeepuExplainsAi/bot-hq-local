import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { env } from './env.js';
import { homeUrl } from './home.js';
import { profilesRoot } from './paths.js';

/**
 * Desktop mode: each bot has its own browser, a separate Electron (Chromium) process with its own profile
 * folder and its own DevTools port. Cookies and logins never mix. Hermes drives it over that port
 * (`browser.cdp_url`), and the viewer shows it through cdpscreen.ts. The desktop shell says how to start
 * one in BOTHQ_BROWSER_CMD; without it (tests, plain server) there are no bot browsers.
 */

interface Running { child: ChildProcess; port: number; ready: Promise<void> }
const running = new Map<string, Running>();
const restarts = new Map<string, number>();
let stopping = false;

const portFile = (botId: string) => path.join(profilesRoot(), botId, 'cdp-port');
const portFree = (port: number) => new Promise<boolean>((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});

/** The same port every time for one bot (its Hermes config names it); a new one only if that port is taken. */
async function portFor(botId: string): Promise<number> {
  try {
    const p = Number(fs.readFileSync(portFile(botId), 'utf8'));
    if (p && (await portFree(p))) return p;
  } catch { /* first start */ }
  const used = new Set([...running.values()].map((r) => r.port));
  let p = 9200;
  while (used.has(p) || !(await portFree(p))) p++;
  fs.mkdirSync(path.dirname(portFile(botId)), { recursive: true });
  fs.writeFileSync(portFile(botId), String(p));
  return p;
}

export const browsersAvailable = () => !!env.browserCmd;

const alive = (port: number) => fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);

async function launch(botId: string): Promise<Running> {
  const { exe, args = [] } = JSON.parse(env.browserCmd) as { exe: string; args?: string[] };
  const port = await portFor(botId);
  const profile = path.join(profilesRoot(), botId, 'browser');
  fs.mkdirSync(profile, { recursive: true });
  // Only what a browser needs to open a window; none of this server's settings.
  const keep = ['PATH', 'HOME', 'USER', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'SystemRoot', 'LANG', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS'];
  const childEnv = {
    ...Object.fromEntries(keep.filter((k) => process.env[k]).map((k) => [k, process.env[k]])),
    BOTHQ_BROWSER_HOST: '1', BOTHQ_BROWSER_PROFILE: profile, BOTHQ_CDP_PORT: String(port), BOTHQ_HOME_URL: homeUrl(botId),
  };
  const child = spawn(exe, args, { env: childEnv, stdio: 'ignore', windowsHide: true });
  child.once('error', (e) => console.warn(`[browser] ${botId}: ${e.message}`));
  const entry: Running = { child, port, ready: Promise.resolve() };
  entry.ready = (async () => {
    for (let i = 0; i < 120; i++) {
      if (await alive(port)) return;
      if (child.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('the bot browser did not start');
  })();
  child.once('exit', (code) => {
    if (running.get(botId)?.child !== child) return;
    running.delete(botId);
    if (stopping) return;
    // Comes back by itself (2 s .. 60 s), like the gateways.
    const n = (restarts.get(botId) ?? 0) + 1;
    restarts.set(botId, n);
    console.warn(`[browser] ${botId} exited (${code}); restarting`);
    setTimeout(() => { if (!stopping && !running.has(botId)) void ensureBotBrowser(botId).catch(() => {}); }, Math.min(60_000, 2000 * 2 ** (n - 1)));
  });
  return entry;
}

/** This bot's browser, started if needed. Resolves with its DevTools address once it answers. */
export async function ensureBotBrowser(botId: string): Promise<string> {
  if (!env.browserCmd) throw new Error('no browser for bots is set up');
  let r = running.get(botId);
  if (!r) {
    r = await launch(botId);
    running.set(botId, r);
  }
  await r.ready;
  restarts.delete(botId);
  return `http://127.0.0.1:${r.port}`;
}

export async function stopBotBrowser(botId: string): Promise<void> {
  const r = running.get(botId);
  running.delete(botId);
  if (!r) return;
  await killChild(r.child);
}

export async function stopAllBrowsers(): Promise<void> {
  stopping = true;
  await Promise.all([...running.keys()].map((id) => stopBotBrowser(id)));
}

function killChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 5000);
    child.once('exit', () => { clearTimeout(t); resolve(); });
    try { child.kill(); } catch { resolve(); }
  });
}
