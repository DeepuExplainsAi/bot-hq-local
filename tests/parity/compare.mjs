// Fails when a screenshot differs from its baseline. No baseline folder yet = nothing to compare (first run).
import fs from 'node:fs';
import crypto from 'node:crypto';
const [a, b] = process.argv.slice(2);
if (!fs.existsSync(a) || !fs.readdirSync(a).some((f) => f.endsWith('.png'))) { console.log('no baselines yet; skipping compare'); process.exit(0); }
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const bad = [];
for (const f of fs.readdirSync(a).filter((f) => f.endsWith('.png'))) {
  if (!fs.existsSync(`${b}/${f}`)) bad.push(`${f}: missing in new run`);
  else if (hash(`${a}/${f}`) !== hash(`${b}/${f}`)) bad.push(`${f}: differs from baseline`);
}
console.log(bad.length ? bad.join('\n') : 'all screenshots match the baselines');
process.exit(bad.length ? 1 : 0);
