// Deterministic stand-in for the Bot HQ API, used only to take UI baseline screenshots.
// It serves fixed data so the screenshots do not depend on the real backend, Hermes or any key.
import fs from 'node:fs';
import http from 'node:http';
import { WebSocketServer } from 'ws';

const T0 = Date.UTC(2026, 0, 15, 12, 0, 0);
const bot = (id, name, label, shape, color, extra = {}) => ({
  id, name, label, description: '', instructions: '', avatarShape: shape, avatarColor: color, mode: 'personal',
  isPrimary: false, kind: 'agent', pinned: false, effort: 'medium', voice: 'eve', voiceSpeed: 1, voiceLanguage: 'auto',
  model: null, provider: null, generation: 1, unread: 0, lastPreview: null, lastActivityAt: T0, createdAt: T0, ...extra,
});
const bots = [
  bot('b1', 'Doug', 'Chief of Staff', 'circle', 'orange', { isPrimary: true, lastPreview: 'Done. The digest is ready.' }),
  bot('b2', 'Quinn', 'Research', 'square', 'blue', { lastPreview: 'Looking into it.' }),
];
const rows = [
  { botId: 'b1', generation: 1, seq: 1, updatedSeq: 1, kind: 'message', body: { type: 'message', role: 'user', text: 'Summarise my week.' }, createdAt: T0 },
  { botId: 'b1', generation: 1, seq: 2, updatedSeq: 2, kind: 'message', body: { type: 'message', role: 'assistant', text: 'Done. The digest is ready.' }, createdAt: T0 + 1000 },
];
const computer = { status: 'running', orgoId: 'mock', error: null, screens: [{ botId: 'b1', screenId: 'default', width: 1280, height: 800 }, { botId: 'b2', screenId: 'screen-100', width: 1280, height: 800 }], maxScreens: 4 };
const routine = { id: 'r1', botId: 'b1', name: 'Daily digest', prompt: 'Send a digest', schedule: '0 9 * * 1-5', timezone: 'UTC', enabled: true, nextRunAt: T0 + 86400000, lastRunAt: null, description: 'Weekdays at 9:00 AM' };
const engine = { running: true, home: 'mock', providers: [], model: null, provider: null };
const apps = [{ slug: 'slack', name: 'Slack', description: 'Team chat', categories: ['Communication'], managedAuth: true, noAuth: false, connected: false }, { slug: 'github', name: 'GitHub', description: 'Code hosting', categories: ['Developer'], managedAuth: true, noAuth: false, connected: true }];

const routes = [
  ['GET', /^\/api\/auth\/me$/, () => (state.signedIn ? { user: { id: 'u1', email: 'me@example.com', name: 'Me', avatarUrl: null }, devLogin: false } : { user: null, devLogin: false })],
  ['GET', /^\/api\/bots$/, () => ({ bots, live: [] })],
  ['GET', /^\/api\/bots\/[^/]+\/rows$/, () => ({ generation: 1, rows })],
  ['GET', /^\/api\/bots\/[^/]+\/routines$/, () => ({ routines: [routine] })],
  ['GET', /^\/api\/computer$/, () => ({ computer })],
  ['GET', /^\/api\/computer\/details$/, () => ({ computer, screens: [], hibernation: { idleMinutes: 30, viewers: 0, dryRun: false } })],
  ['GET', /^\/api\/bots\/[^/]+\/settings$/, () => ({ memories: [], skills: [], routines: [routine], tasks: [], memory: { lastConsolidatedAt: null, historyChars: 0, compactAtChars: 100000, lastCompaction: null } })],
  ['GET', /^\/api\/bots\/[^/]+\/engine$/, () => ({ engine })],
  ['GET', /^\/api\/bots\/[^/]+\/files$/, () => ({ status: 'ok', path: '', files: [{ name: 'report.md', size: 1200, modifiedAt: T0, isDir: false }] })],
  ['GET', /^\/api\/bots\/[^/]+\/tasks$/, () => ({ tasks: [] })],
  ['GET', /^\/api\/tasks$/, () => ({ tasks: [] })],
  ['GET', /^\/api\/policies$/, () => ({ policies: [] })],
  ['GET', /^\/api\/apps$/, () => ({ apps, connected: ['github'], categories: ['Communication', 'Developer'], total: 2, connectedApps: apps.filter((a) => a.connected) })],
  ['GET', /^\/api\/bots\/[^/]+\/screenshot$/, () => null],
  ['GET', /^\/api\/voice\/options$/, () => ({ voices: [{ id: 'eve', name: 'Eve' }, { id: 'ara', name: 'Ara' }], languages: [{ code: 'auto', name: 'Auto' }, { code: 'en', name: 'English' }], speeds: [0.7, 1, 1.5] })],
  ['GET', /^\/api\/health$/, () => ({ ok: true })],
];
const state = { signedIn: true };

const wss = new WebSocketServer({ noServer: true, handleProtocols: (p) => (p.has('binary') ? 'binary' : false) });
const FRAME = fs.readFileSync(new URL('./screen.jpg', import.meta.url));
const W = 1280, H = 800;
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
function serveFrame(ws) {
  let stage = 0, buf = Buffer.alloc(0);
  ws.send(Buffer.from('RFB 003.008\n'));
  ws.on('message', (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (stage === 0 && buf.length >= 12) { buf = buf.subarray(12); stage = 1; ws.send(Buffer.from([1, 1])); }
      else if (stage === 1 && buf.length >= 1) { buf = buf.subarray(1); stage = 2; ws.send(u32(0)); }
      else if (stage === 2 && buf.length >= 1) {
        buf = buf.subarray(1); stage = 3;
        ws.send(Buffer.concat([u16(W), u16(H), Buffer.from([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]), u32(4), Buffer.from('Doug')]));
      } else if (stage === 3 && buf.length >= 1) {
        const len = { 0: 20, 3: 10, 4: 8, 5: 6 }[buf[0]] ?? (buf[0] === 2 && buf.length >= 4 ? 4 + 4 * buf.readUInt16BE(2) : 0);
        if (!len || buf.length < len) break;
        const t = buf[0]; buf = buf.subarray(len);
        if (t === 3) {
          const n = FRAME.length, l = [n & 0x7f | 0x80, (n >> 7) & 0x7f | 0x80, (n >> 14) & 0xff];
          ws.send(Buffer.concat([Buffer.from([0, 0]), u16(1), u16(0), u16(0), u16(W), u16(H), u32(7), Buffer.from([0x90, ...l]), FRAME]));
        }
      } else break;
    }
  });
  ws.on('error', () => {});
}
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__signed-out') { state.signedIn = false; res.end('ok'); return; }
  if (url.pathname === '/__signed-in') { state.signedIn = true; res.end('ok'); return; }
  if (url.pathname === '/api/events') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': ok\n\n'); return; }
  const hit = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
  if (!hit) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return; }
  const body = hit[2]();
  if (body === null) { res.writeHead(204); res.end(); return; }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body));
}).on('upgrade', (req, socket, head) => {
  // The bot screen viewer gets one fixed picture (RFB with a Tight JPEG rectangle), so the screen preview is the same every run.
  if (/^\/api\/bots\/[^/]+\/screen/.test(req.url ?? '')) wss.handleUpgrade(req, socket, head, serveFrame);
  else socket.destroy();
}).listen(Number(process.env.MOCK_PORT ?? 8799), '127.0.0.1');
