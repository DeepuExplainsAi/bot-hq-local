import { WebSocket } from 'ws';
import { ensureBotBrowser } from './botbrowser.js';

/**
 * The bot's browser as a VNC screen. The viewer (noVNC) speaks RFB, so this answers it as an RFB server:
 * every frame the browser's DevTools screencast produces goes out as a Tight-JPEG rectangle (the JPEG bytes
 * pass through untouched), and in control mode the viewer's mouse and key events become DevTools Input.*
 * calls. In watch mode input is dropped here.
 */

const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };

/** Width and height of a JPEG, from its start-of-frame marker. */
export function jpegSize(j: Buffer): { w: number; h: number } | null {
  for (let i = 2; i + 9 < j.length;) {
    if (j[i] !== 0xff) { i++; continue; }
    const m = j[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: j.readUInt16BE(i + 5), w: j.readUInt16BE(i + 7) };
    i += 2 + j.readUInt16BE(i + 2);
  }
  return null;
}

/** ServerInit: size, 32-bit true-colour pixel format, name. */
export function serverInit(w: number, h: number, name = 'Bot browser'): Buffer {
  const fmt = Buffer.from([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]);
  return Buffer.concat([u16(w), u16(h), fmt, u32(Buffer.byteLength(name)), Buffer.from(name)]);
}

/** One FramebufferUpdate holding the whole screen as a Tight JPEG rectangle. */
export function jpegUpdate(w: number, h: number, jpeg: Buffer): Buffer {
  const len: number[] = [];
  let n = jpeg.length;
  len.push(n & 0x7f);
  if (n > 0x7f) { len[0] |= 0x80; len.push((n >> 7) & 0x7f); if (n > 0x3fff) { len[1] |= 0x80; len.push((n >> 14) & 0xff); } }
  return Buffer.concat([Buffer.from([0, 0]), u16(1), u16(0), u16(0), u16(w), u16(h), u32(7), Buffer.from([0x90, ...len]), jpeg]);
}

/** Length of the client message at the head of `b`; 0 = need more bytes, -1 = unknown. */
export function clientMessageLength(b: Buffer): number {
  switch (b[0]) {
    case 0: return 20;
    case 2: return b.length < 4 ? 0 : 4 + 4 * b.readUInt16BE(2);
    case 3: return 10;
    case 4: return 8;
    case 5: return 6;
    case 6: return b.length < 8 ? 0 : 8 + Math.abs(b.readInt32BE(4));
    case 150: return 10;
    case 248: return b.length < 9 ? 0 : 9 + b[8];
    case 251: return b.length < 8 ? 0 : 8 + 16 * b[6];
    default: return -1;
  }
}

// ---------------------------------------------------------------- DevTools connection

class Cdp {
  private ws: WebSocket;
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private handlers = new Map<string, (p: any) => void>();
  onClose: () => void = () => {};
  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => {
      const m = JSON.parse(String(data));
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) p?.reject(new Error(m.error.message)); else p?.resolve(m.result);
      } else if (m.method) this.handlers.get(m.method)?.(m.params);
    });
    ws.on('close', () => { for (const p of this.pending.values()) p.reject(new Error('browser closed')); this.pending.clear(); this.onClose(); });
    ws.on('error', () => {});
  }
  static async open(base: string): Promise<Cdp> {
    const list = (await (await fetch(`${base}/json/list`, { signal: AbortSignal.timeout(5000) })).json()) as any[];
    const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!page) throw new Error('the bot browser has no page open');
    const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
    await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
    return new Cdp(ws);
  }
  send(method: string, params: object = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }), (e) => { if (e) { this.pending.delete(id); reject(e); } });
    });
  }
  on(method: string, fn: (p: any) => void) { this.handlers.set(method, fn); }
  close() { try { this.ws.close(); } catch { /* gone */ } }
}

/** A PNG/JPEG snapshot of the bot's browser, for the small preview. */
export async function captureBotScreen(botId: string): Promise<Buffer> {
  const cdp = await Cdp.open(await ensureBotBrowser(botId));
  try {
    const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
    return Buffer.from(r.data, 'base64');
  } finally { cdp.close(); }
}

// ---------------------------------------------------------------- keys and buttons

const SPECIAL: Record<number, { key: string; code: string; vk: number; text?: string }> = {
  0xff08: { key: 'Backspace', code: 'Backspace', vk: 8 }, 0xff09: { key: 'Tab', code: 'Tab', vk: 9 },
  0xff0d: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' }, 0xff1b: { key: 'Escape', code: 'Escape', vk: 27 },
  0xffff: { key: 'Delete', code: 'Delete', vk: 46 }, 0xff50: { key: 'Home', code: 'Home', vk: 36 },
  0xff51: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 }, 0xff52: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  0xff53: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 }, 0xff54: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  0xff55: { key: 'PageUp', code: 'PageUp', vk: 33 }, 0xff56: { key: 'PageDown', code: 'PageDown', vk: 34 },
  0xff57: { key: 'End', code: 'End', vk: 35 }, 0xff63: { key: 'Insert', code: 'Insert', vk: 45 },
  0xffe1: { key: 'Shift', code: 'ShiftLeft', vk: 16 }, 0xffe2: { key: 'Shift', code: 'ShiftRight', vk: 16 },
  0xffe3: { key: 'Control', code: 'ControlLeft', vk: 17 }, 0xffe4: { key: 'Control', code: 'ControlRight', vk: 17 },
  0xffe9: { key: 'Alt', code: 'AltLeft', vk: 18 }, 0xffea: { key: 'Alt', code: 'AltRight', vk: 18 },
  0xffeb: { key: 'Meta', code: 'MetaLeft', vk: 91 }, 0xffec: { key: 'Meta', code: 'MetaRight', vk: 92 },
};
for (let i = 1; i <= 12; i++) SPECIAL[0xffbe + i - 1] = { key: `F${i}`, code: `F${i}`, vk: 111 + i };
const MODIFIER_BIT: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

// ---------------------------------------------------------------- the RFB side

/**
 * Serve one viewer. `handshake` runs the RFB opening with the ServerInit we make from the first frame.
 * Returns what to feed with the viewer's later bytes, and how to stop.
 */
export async function serveBotScreen(
  botId: string, mode: 'watch' | 'control',
  handshake: (init: Buffer) => Promise<void>, send: (b: Buffer) => void,
): Promise<{ input: (b: Buffer) => void; close: () => void }> {
  const cdp = await Cdp.open(await ensureBotBrowser(botId));
  type Frame = { w: number; h: number; jpeg: Buffer };
  let frame = null as Frame | null;
  let fresh = false;     // a frame the viewer has not got yet
  let asked = false;     // the viewer has an open request
  let onFirst: () => void = () => {};
  const first = new Promise<void>((r) => { onFirst = r; });
  let closed = false;

  const flush = () => {
    if (!frame || !asked || !fresh || closed) return;
    asked = false; fresh = false;
    send(jpegUpdate(frame.w, frame.h, frame.jpeg));
  };
  cdp.on('Page.screencastFrame', (p) => {
    const jpeg = Buffer.from(p.data, 'base64');
    const d = jpegSize(jpeg);
    cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
    if (!d) return;
    frame = { ...d, jpeg };
    fresh = true;
    onFirst();
    flush();
  });
  await cdp.send('Page.enable');
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 75, maxWidth: 1920, maxHeight: 1200, everyNthFrame: 1 });
  await Promise.race([first, new Promise((_, rej) => setTimeout(() => rej(new Error('the bot browser sent no picture')), 10_000))]);
  const firstSize = frame!;
  await handshake(serverInit(firstSize.w, firstSize.h));

  let buttons = 0, modifiers = 0, mx = 0, my = 0;
  const mouse = (type: string, extra: object = {}) => cdp.send('Input.dispatchMouseEvent', { type, x: mx, y: my, modifiers, ...extra }).catch(() => {});
  const BTN = ['left', 'middle', 'right'];
  const pointer = (mask: number, x: number, y: number) => {
    mx = x; my = y;
    const down = mask & 7, was = buttons & 7;
    const cdpButtons = (down & 1) | (down & 4 ? 2 : 0) | (down & 2 ? 4 : 0); // DevTools orders them left, right, middle
    // RFB bit order: 1 left, 2 middle, 4 right; wheel up/down are bits 8 and 16.
    const names: [number, string][] = [[1, 'left'], [2, 'middle'], [4, 'right']];
    let moved = true;
    for (const [bit, name] of names) {
      if (down & bit && !(was & bit)) { moved = false; void mouse('mousePressed', { button: name, buttons: cdpButtons, clickCount: 1 }); }
      else if (!(down & bit) && was & bit) { moved = false; void mouse('mouseReleased', { button: name, buttons: cdpButtons, clickCount: 1 }); }
    }
    if (moved) void mouse('mouseMoved', { buttons: cdpButtons, button: down ? BTN[Math.log2(down & -down)] : 'none' });
    if (mask & 8 && !(buttons & 8)) void mouse('mouseWheel', { deltaX: 0, deltaY: -100 });
    if (mask & 16 && !(buttons & 16)) void mouse('mouseWheel', { deltaX: 0, deltaY: 100 });
    buttons = mask;
  };
  const key = (downKey: boolean, sym: number) => {
    const s = SPECIAL[sym];
    const cp = sym >= 0x01000000 ? sym - 0x01000000 : sym >= 0x20 && sym <= 0xff ? sym : 0;
    const bit = s ? MODIFIER_BIT[s.key] : 0;
    if (bit) modifiers = downKey ? modifiers | bit : modifiers & ~bit;
    const text = s ? s.text : cp && !(modifiers & 6) ? String.fromCodePoint(cp) : undefined; // Ctrl/Cmd shortcuts carry no text
    const k = s?.key ?? (cp ? String.fromCodePoint(cp) : '');
    if (!k) return;
    void cdp.send('Input.dispatchKeyEvent', {
      type: downKey ? (text ? 'keyDown' : 'rawKeyDown') : 'keyUp', modifiers, key: k, code: s?.code,
      windowsVirtualKeyCode: s?.vk ?? (cp >= 0x61 && cp <= 0x7a ? cp - 32 : cp), ...(downKey && text ? { text, unmodifiedText: text } : {}),
    }).catch(() => {});
  };

  let pending = Buffer.alloc(0);
  const input = (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      if (!pending.length) return;
      const len = clientMessageLength(pending);
      if (len === -1) { pending = Buffer.alloc(0); return; } // unknown: fail closed
      if (len === 0 || pending.length < len) return;
      const m = pending.subarray(0, len);
      pending = pending.subarray(len);
      if (m[0] === 3) { // FramebufferUpdateRequest
        asked = true;
        if (m[1] === 0) fresh = true; // not incremental: send the picture again
        flush();
      } else if (mode === 'control' && m[0] === 5) pointer(m[1], m.readUInt16BE(2), m.readUInt16BE(4));
      else if (mode === 'control' && m[0] === 4) key(m[1] === 1, m.readUInt32BE(4));
      // Everything else (pixel format, encodings, clipboard, and any input in watch mode) is ignored.
    }
  };
  return { input, close: () => { closed = true; cdp.send('Page.stopScreencast').catch(() => {}).finally(() => cdp.close()); } };
}
