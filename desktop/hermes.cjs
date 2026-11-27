// First-run setup of the Hermes agent (a Python program) inside the app's own data folder: nothing is installed
// system-wide and ~/.hermes is never touched. Steps: uv (pinned, checksum-verified) -> Python -> Hermes (pinned).
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const UV_VERSION = '0.13.10';
const HERMES_VERSION = 'v0.23.4';
const PYTHON = '3.14';

const win = process.platform === 'win32';
const TRIPLES = {
  'linux-x64': 'x86_64-unknown-linux-gnu', 'linux-arm64': 'aarch64-unknown-linux-gnu',
  'darwin-x64': 'x86_64-apple-darwin', 'darwin-arm64': 'aarch64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc', 'win32-arm64': 'aarch64-pc-windows-msvc',
};

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout, stderr) => {
    if (err) reject(new Error(`${path.basename(cmd)} ${args[0] ?? ''} failed: ${String(stderr || stdout || err.message).trim().split('\n').slice(-6).join('\n')}`));
    else resolve(stdout);
  });
});

async function download(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10 * 60_000) });
  if (!res.ok) throw new Error(`download ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const hit = findFile(p, name); if (hit) return hit; }
    else if (e.name === name) return p;
  }
  return null;
}

/** uv, downloaded once from its GitHub release and checked against the published SHA-256. */
async function ensureUv(root, say) {
  const uv = path.join(root, 'tools', win ? 'uv.exe' : 'uv');
  if (fs.existsSync(uv)) return uv;
  const triple = TRIPLES[`${process.platform}-${process.arch}`];
  if (!triple) throw new Error(`No uv build for ${process.platform}/${process.arch}.`);
  const asset = `uv-${triple}.${win ? 'zip' : 'tar.gz'}`;
  const base = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset}`;
  say(`Downloading uv ${UV_VERSION}`);
  const [archive, sum] = await Promise.all([download(base), download(`${base}.sha256`)]);
  const want = sum.toString('utf8').trim().split(/\s+/)[0].toLowerCase();
  const got = crypto.createHash('sha256').update(archive).digest('hex');
  if (want !== got) throw new Error(`uv download is corrupt (checksum ${got} does not match ${want}).`);
  const tmp = fs.mkdtempSync(path.join(root, 'uv-'));
  try {
    const file = path.join(tmp, asset);
    fs.writeFileSync(file, archive);
    await run('tar', ['-xf', file, '-C', tmp]); // Windows 10+ ships a tar that reads zip files too
    const found = findFile(tmp, path.basename(uv));
    if (!found) throw new Error('uv was not in its archive.');
    fs.mkdirSync(path.dirname(uv), { recursive: true });
    fs.copyFileSync(found, uv);
    fs.chmodSync(uv, 0o755);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return uv;
}

/**
 * Make sure Hermes is installed under `<root>` and return the path of its `hermes` program.
 * `say(text)` reports progress. Throws with a readable message; nothing silently falls back to WSL2 or Docker.
 */
async function ensureHermes(root, say = () => {}) {
  const venv = path.join(root, 'venv');
  const bin = path.join(venv, win ? 'Scripts' : 'bin', win ? 'hermes.exe' : 'hermes');
  const stamp = path.join(root, 'installed.json');
  const want = { hermes: HERMES_VERSION, python: PYTHON };
  try {
    const have = JSON.parse(fs.readFileSync(stamp, 'utf8'));
    if (have.hermes === want.hermes && have.python === want.python && fs.existsSync(bin)) return bin;
  } catch { /* not installed yet */ }

  fs.mkdirSync(root, { recursive: true });
  const uv = await ensureUv(root, say);
  const env = {
    ...process.env,
    UV_PYTHON_INSTALL_DIR: path.join(root, 'python'),
    UV_CACHE_DIR: path.join(root, 'uv-cache'),
    UV_NO_CONFIG: '1',
    HERMES_HOME: path.join(root, 'install-home'), // anything Hermes writes while installing stays here
  };
  say(`Setting up Python ${PYTHON}`);
  await run(uv, ['venv', '--python', PYTHON, '--managed-python', '--clear', venv], { env });
  say(`Installing Hermes Agent ${HERMES_VERSION} (a few minutes, once)`);
  const source = `hermes-agent[all] @ https://github.com/NousResearch/hermes-agent/archive/refs/tags/${HERMES_VERSION}.tar.gz`;
  await run(uv, ['pip', 'install', '--python', venv, source], { env, timeout: 30 * 60_000 });
  if (!fs.existsSync(bin)) throw new Error(`Hermes installed but ${bin} is missing.`);
  say('Checking Hermes');
  await run(bin, ['--version'], { env, timeout: 120_000 });
  fs.writeFileSync(stamp, JSON.stringify(want));
  return bin;
}

module.exports = { ensureHermes, UV_VERSION, HERMES_VERSION, PYTHON };
