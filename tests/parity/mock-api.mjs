// Deterministic stand-in for the Bot HQ API, used only to take UI baseline screenshots.
// It serves fixed data so the screenshots do not depend on the real backend, Hermes or any key.
import http from 'node:http';

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
}).listen(Number(process.env.MOCK_PORT ?? 8799), '127.0.0.1');
