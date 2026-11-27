// Builds the folder the installer ships next to the Electron shell: build/stage/{server,web,node_modules}.
// Needs `npm run build` first. 
// Usage: node scripts/stage-desktop.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const OUT = path.join(ROOT, 'build', 'stage');
const need = (p) => { if (!fs.existsSync(path.join(ROOT, p))) throw new Error(`${p} is missing: run \`npm run build\` first`); };
need('server/dist/index.js'); need('web/dist/index.html');

fs.rmSync(OUT, { recursive: true, force: true });
const copy = (from, to) => fs.cpSync(path.join(ROOT, from), path.join(OUT, to), { recursive: true });
copy('server/dist', 'server/dist');
copy('server/box', 'server/box');
copy('server/package.json', 'server/package.json');
copy('web/dist', 'web/dist');

// The server's own dependencies only (no dev tools, no web build tools), exactly the versions in the lock file.
const server = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const pinned = {};
for (const name of Object.keys(server.dependencies)) {
  const v = (lock.packages[`server/node_modules/${name}`] ?? lock.packages[`node_modules/${name}`])?.version;
  if (!v) throw new Error(`${name} is not in package-lock.json`);
  pinned[name] = v;
}
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({ name: 'bot-hq-stage', private: true, dependencies: pinned }, null, 2));

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args) => execFileSync(cmd, args, { cwd: OUT, stdio: 'inherit', shell: process.platform === 'win32' });
run(npm, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);

// better-sqlite3 ships N-API prebuilds for every OS and CPU, which work in Electron's Node as they are: nothing to compile.
console.log(`staged ${OUT}`);
