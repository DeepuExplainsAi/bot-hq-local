// Fails when a screenshot differs from its baseline. No baseline folder yet = nothing to compare (first run).
// Identical bytes pass. Otherwise a tiny raster jitter is tolerated (<= 20 pixels, each channel off by <= 2):
// the same page rendered twice on the CI runner can differ by one level in a single pixel.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { PNG } from 'pngjs';
const [a, b] = process.argv.slice(2);
if (!fs.existsSync(a) || !fs.readdirSync(a).some((f) => f.endsWith('.png'))) { console.log('no baselines yet; skipping compare'); process.exit(0); }
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const MAX_PIXELS = 20, MAX_DELTA = 2;
function jitterOnly(fa, fb) {
  const x = PNG.sync.read(fs.readFileSync(fa)), y = PNG.sync.read(fs.readFileSync(fb));
  if (x.width !== y.width || x.height !== y.height) return false;
  let n = 0;
  for (let i = 0; i < x.data.length; i += 4) {
    let m = 0;
    for (let c = 0; c < 4; c++) m = Math.max(m, Math.abs(x.data[i + c] - y.data[i + c]));
    if (m > MAX_DELTA) return false;
    if (m > 0 && ++n > MAX_PIXELS) return false;
  }
  return true;
}
const bad = [];
for (const f of fs.readdirSync(a).filter((f) => f.endsWith('.png'))) {
  if (!fs.existsSync(`${b}/${f}`)) bad.push(`${f}: missing in new run`);
  else if (hash(`${a}/${f}`) !== hash(`${b}/${f}`)) {
    if (jitterOnly(`${a}/${f}`, `${b}/${f}`)) console.log(`${f}: raster jitter only (tolerated)`);
    else bad.push(`${f}: differs from baseline`);
  }
}
console.log(bad.length ? bad.join('\n') : 'all screenshots match the baselines');
process.exit(bad.length ? 1 : 0);
