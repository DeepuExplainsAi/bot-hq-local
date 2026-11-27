// A minimal viewer-side RFB client for tests. Self-contained (no outer variables) so the same function runs
// in Node with `ws` and, as source text, inside the Electron page (browser WebSocket).
// Opens a session, asks for one picture and returns what arrived. `after` (bytes) is sent once the picture is in.
async function rfbProbe(ws, after) {
  ws.binaryType = 'arraybuffer';
  let buf = new Uint8Array(0);
  let wake = null;
  ws.onmessage = (m) => {
    const d = new Uint8Array(m.data);
    const n = new Uint8Array(buf.length + d.length);
    n.set(buf); n.set(d, buf.length); buf = n;
    if (wake) { const w = wake; wake = null; w(); }
  };
  const read = async (n) => {
    const end = Date.now() + 20000;
    while (buf.length < n) {
      if (Date.now() > end) throw new Error('timed out reading ' + n + ' bytes (have ' + buf.length + ')');
      await new Promise((r) => { wake = r; setTimeout(r, 200); });
    }
    const out = buf.slice(0, n); buf = buf.slice(n); return out;
  };
  const u16 = (a, i) => (a[i] << 8) | a[i + 1];
  const u32 = (a, i) => ((a[i] << 24) | (a[i + 1] << 16) | (a[i + 2] << 8) | a[i + 3]) >>> 0;
  await new Promise((res, rej) => { if (ws.readyState === 1) res(); else { ws.onopen = () => res(); ws.onerror = () => rej(new Error('socket error')); } });
  const hello = new TextDecoder().decode(await read(12));
  if (!hello.startsWith('RFB ')) throw new Error('not RFB: ' + hello);
  ws.send(new TextEncoder().encode('RFB 003.008\n'));
  const nTypes = (await read(1))[0];
  const types = Array.from(await read(nTypes));
  if (!types.includes(1)) throw new Error('no "None" security type: ' + types);
  ws.send(new Uint8Array([1]));
  if (u32(await read(4), 0) !== 0) throw new Error('security refused');
  ws.send(new Uint8Array([1])); // ClientInit
  const head = await read(24);
  const width = u16(head, 0), height = u16(head, 2);
  await read(u32(head, 20)); // name
  ws.send(new Uint8Array([2, 0, 0, 1, 0, 0, 0, 7])); // SetEncodings: Tight
  ws.send(new Uint8Array([3, 0, 0, 0, 0, 0, width >> 8, width & 255, height >> 8, height & 255])); // full request
  const up = await read(4);
  if (up[0] !== 0) throw new Error('first message is not a FramebufferUpdate: ' + up[0]);
  const rh = await read(12);
  const encoding = u32(rh, 8);
  const ctl = (await read(1))[0];
  let len = 0, shift = 0, b;
  do { b = (await read(1))[0]; len |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
  const jpeg = await read(len);
  if (after && after.length) { for (const m of after) ws.send(new Uint8Array(m)); await new Promise((r) => setTimeout(r, 1000)); }
  return { width, height, rectW: u16(rh, 4), rectH: u16(rh, 6), encoding, ctl, jpegLen: len, jpegStart: [jpeg[0], jpeg[1]] };
}
module.exports = { rfbProbe };
