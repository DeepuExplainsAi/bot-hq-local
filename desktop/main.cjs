// Bot HQ desktop shell. Starts the server on a loopback port (with everything it needs in the OS app-data folder),
// sets up Hermes on first run, shows the app in a window, and stops the server and the agents on quit.
const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { ensureHermes } = require('./hermes.cjs');
const { signInUrl } = require('./localauth.cjs');

const SMOKE = process.argv.includes('--smoke');
const trace = (m) => { if (SMOKE) console.log(`[smoke] ${m}`); };
const ROOT = process.env.BOTHQ_ROOT || path.resolve(__dirname, '..'); // the folder holding server/ and web/
const PREFERRED_PORT = 8787;

app.setName('Bot HQ');
// CI smoke runs never touch a real profile.
if (SMOKE) app.setPath('userData', fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bothq-smoke-')));
let win = null;
let server = null;
let quitting = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dirs = () => {
  const home = app.getPath('userData');
  return { data: path.join(home, 'data'), hermes: path.join(home, 'hermes'), logs: path.join(home, 'logs') };
};

const portFree = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once('error', () => resolve(false));
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
});
const randomPort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
/** The same port every launch when possible: the page's saved settings belong to its address. */
async function pickPort() {
  return (await portFree(PREFERRED_PORT)) ? PREFERRED_PORT : randomPort();
}

const showStatus = (text, error = false) => {
  if (!win || win.isDestroyed()) return;
  win.loadFile(path.join(__dirname, 'setup.html'), { query: { text, ...(error ? { error: '1' } : {}) } });
};

function startServer(port, hermesBin) {
  const { data, logs } = dirs();
  fs.mkdirSync(logs, { recursive: true });
  fs.mkdirSync(data, { recursive: true }); // the server's working folder
  const log = fs.openSync(path.join(logs, 'server.log'), 'a');
  const url = `http://127.0.0.1:${port}`;
  // Only what the server needs. Cloud keys are never passed; XAI_API_KEY is the user's own optional key.
  const pass = ['PATH', 'HOME', 'USER', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'SystemRoot', 'ComSpec', 'PATHEXT', 'LANG', 'XAI_API_KEY'];
  const env = {
    ...Object.fromEntries(pass.filter((k) => process.env[k]).map((k) => [k, process.env[k]])),
    ELECTRON_RUN_AS_NODE: '1',
    BOTHQ_LOCAL: '1',
    BOTHQ_DATA: data,
    BOTHQ_WEB_DIST: path.join(ROOT, 'web', 'dist'),
    PORT: String(port), APP_URL: url, SERVER_URL: url, MCP_BASE_URL: url,
    ...(hermesBin ? { HERMES_BIN: hermesBin, BOTHQ_EXTRA_PATH: path.dirname(hermesBin) } : {}),
  };
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'dist', 'index.js')], { cwd: data, env, stdio: ['ignore', log, log, 'ipc'], windowsHide: true });
  fs.closeSync(log);
  server.once('error', (e) => { console.error(`server: ${e.message}`); });
  server.once('exit', (code) => {
    server = null;
    if (quitting) return;
    const message = `The Bot HQ server exited (code ${code}). See ${path.join(logs, 'server.log')}.`;
    if (SMOKE) console.error(`${message}\n${fs.readFileSync(path.join(logs, 'server.log'), 'utf8')}`);
    else dialog.showErrorBox('Bot HQ stopped', message); // a modal box would hang a CI run
    app.exit(1);
  });
  return url;
}

async function waitForHealth(url, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!server) throw new Error('The server stopped while starting.');
    if (await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false)) return;
    await sleep(250);
  }
  throw new Error('The server did not start within a minute.');
}

/** Ask the server to stop (it stops the agents it started), and make sure it is gone. */
async function stopServer() {
  const s = server;
  if (!s) return;
  const gone = new Promise((r) => s.once('exit', r));
  try { s.send('quit'); } catch { s.kill(); }
  if ((await Promise.race([gone, sleep(20_000).then(() => 'late')])) === 'late') s.kill('SIGKILL');
}

/** Smoke mode (CI): the page must load and draw the app, and nothing may be requested from outside this machine. */
async function smoke(url) {
  const outside = [];
  win.webContents.session.webRequest.onBeforeRequest((d, cb) => {
    const host = new URL(d.url).hostname;
    if (!['127.0.0.1', 'localhost'].includes(host) && !d.url.startsWith('file:') && !d.url.startsWith('devtools:')) outside.push(d.url);
    cb({});
  });
  await win.loadURL(await signInUrl(dirs().data, url));
  const end = Date.now() + 20_000;
  let drawn = false;
  while (!drawn && Date.now() < end) {
    drawn = await win.webContents.executeJavaScript(`document.title === 'Bot HQ' && (document.getElementById('root')?.children.length ?? 0) > 0`);
    if (!drawn) await sleep(250);
  }
  if (!drawn) throw new Error('the app page did not draw');
  const me = await win.webContents.executeJavaScript(`fetch('/api/auth/me').then((r) => r.json())`);
  if (me.user?.email !== 'me@localhost') throw new Error(`not signed in as the local user: ${JSON.stringify(me)}`);
  if (outside.length) throw new Error(`requests left this machine: ${outside.join(', ')}`);
  console.log(`SMOKE OK ${url}`);
}

async function main() {
  const { hermes } = dirs();
  if (SMOKE) {
    // A hung start must fail the CI step with the server's own log, not run until the job times out.
    setTimeout(() => {
      console.error('SMOKE TIMEOUT. server.log:\n' + (fs.existsSync(path.join(dirs().logs, 'server.log')) ? fs.readFileSync(path.join(dirs().logs, 'server.log'), 'utf8') : '(none)'));
      app.exit(1);
    }, 90_000).unref();
  }
  trace('main');
  win = new BrowserWindow({ width: 1440, height: 900, minWidth: 900, minHeight: 600, title: 'Bot HQ', show: !SMOKE, backgroundColor: '#f5f5f5' });
  win.removeMenu?.();
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });

  let hermesBin = null;
  if (!SMOKE) {
    showStatus('Starting…');
    try {
      hermesBin = await ensureHermes(hermes, showStatus);
    } catch (e) {
      // No silent fallback to WSL2 or Docker: say what failed and stop.
      showStatus(`Hermes could not be set up.\n\n${e.message}`, true);
      return;
    }
  }
  const port = await pickPort();
  const url = startServer(port, hermesBin);
  trace(`server started on ${url}`);
  await waitForHealth(url);
  trace('server healthy');
  // The page may only talk to its own server: navigation elsewhere opens the browser instead.
  win.webContents.on('will-navigate', (e, to) => { if (!to.startsWith(url) && !to.startsWith('file:')) { e.preventDefault(); if (/^https?:/.test(to)) shell.openExternal(to); } });
  if (SMOKE) return smoke(url);
  await win.loadURL(await signInUrl(dirs().data, url)); // single local user: no sign-in page
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.on('before-quit', (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    stopServer().finally(() => app.exit(process.exitCode ?? 0));
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(main).catch((e) => {
    console.error(e);
    process.exitCode = 1;
    if (SMOKE) app.quit(); else showStatus(String(e.message ?? e), true);
  }).then(() => { if (SMOKE) app.quit(); });
}
