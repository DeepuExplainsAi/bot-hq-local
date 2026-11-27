// Lists the license of every package the local tool servers pull in (their whole dependency tree).
// Usage: node scripts/licenses.mjs   -> one line per license with its packages; exit 1 if one is not permissive.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOTS = ['@modelcontextprotocol/server-github', '@modelcontextprotocol/server-slack', '@notionhq/notion-mcp-server', '@tacticlaunch/mcp-linear', '@zereight/mcp-gitlab', '@modelcontextprotocol/sdk'];
const OK = /^(MIT|ISC|BSD-[23]-Clause|Apache-2\.0|0BSD|BlueOak-1\.0\.0|CC0-1\.0|Python-2\.0|Unlicense)$/;
const require = createRequire(path.resolve('server/package.json'));
const seen = new Map();

function find(name, from) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const f = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(f)) return f;
    if (dir === path.dirname(dir)) return null;
  }
}
function visit(name, from) {
  const f = find(name, from);
  if (!f || seen.has(f)) return;
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const lic = typeof j.license === 'string' ? j.license : j.license?.type ?? (j.licenses ?? []).map((l) => l.type).join(' OR ') ?? 'UNKNOWN';
  seen.set(f, { name: j.name, version: j.version, license: lic || 'UNKNOWN' });
  for (const d of Object.keys(j.dependencies ?? {})) visit(d, path.dirname(f));
}
for (const r of ROOTS) visit(r, path.resolve('server'));
const by = {};
for (const p of seen.values()) (by[p.license] ??= []).push(`${p.name}@${p.version}`);
let bad = 0;
for (const [lic, pk] of Object.entries(by).sort()) {
  const fine = lic.split(/\s+(?:OR|AND)\s+|[()]/).map((x) => x.trim()).filter(Boolean).some((x) => OK.test(x));
  if (!fine) bad += pk.length;
  console.log(`${fine ? 'ok ' : 'BAD'} ${lic} (${pk.length}): ${lic === 'MIT' ? '' : pk.join(', ')}`);
}
console.log(`${seen.size} packages, ${bad} not on the allowed list`);
process.exit(bad ? 1 : 0);
