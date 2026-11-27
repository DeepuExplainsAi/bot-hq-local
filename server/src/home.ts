import crypto from 'node:crypto';
import fs from 'node:fs';
import { Hono } from 'hono';
import { db } from './db.js';
import { env } from './env.js';
import { lookFor, type DeskBot } from './desk.js';

/**
 * Desktop mode: the home page of a bot's browser (its avatar, a clock, a greeting), the same page the cloud
 * computer shows on a new tab (server/box/home.html). The page is served here instead of by hq-home.py.
 * Each bot's address carries a key, so only that bot's browser (which is started with it) can open it.
 * Apps: only the browser tile; a laptop's own apps are not launched from here (see docs/local-audit.md).
 */

const TEMPLATE = new URL('../box/home.html', import.meta.url);
const keyFor = (botId: string) => crypto.createHmac('sha256', env.sessionSecret).update(`home:${botId}`).digest('hex');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Where a bot's browser opens its home page. */
export const homeUrl = (botId: string) => `${env.mcpBaseUrl}/bot-home/${botId}/${keyFor(botId)}/`;

function botLook(botId: string) {
  const b = db.prepare('SELECT id, name, label, avatar_shape, avatar_color FROM bots WHERE id=?').get(botId) as any;
  if (!b) return null;
  const bot: DeskBot = { id: b.id, name: b.name, label: b.label ?? '', avatarShape: b.avatar_shape, avatarColor: b.avatar_color };
  return lookFor(bot, true).full;
}

function render(look: Record<string, any>, base: string): string {
  const colors = look.colors ?? {};
  const name = String(look.bot?.name ?? '').trim();
  const values: Record<string, string> = {
    ACCENT: colors.accent, INK: colors.ink, WASH: colors.wash,
    STAMP: esc(String(look.stamp ?? '')), TITLE: 'Home',
    GREETING: esc(name ? `Welcome back, ${name}` : 'Welcome back'), LABEL: esc(String(look.bot?.label ?? '').trim()),
    AVATAR_SVG: look.avatarSvg, BACKDROP_SVG: String(look.wallSvg).replace('__W__', '100%').replace('__H__', '100%'),
  };
  return fs.readFileSync(TEMPLATE, 'utf8')
    .replace(/\{\{([A-Z_]+)\}\}/g, (_m, k) => values[k] ?? '')
    // The page asks its server for things by root-relative address; here they live under this bot's own path.
    .replace(/(['"])\/(apps|stamp|launch)\1/g, `$1${base}$2$1`)
    .replace("'/icon?id='", `'${base}icon?id='`)
    .replace('href="/favicon.svg', `href="${base}favicon.svg`)
    .replace("window.open('/home'", `window.open('${base}'`);
}

export const homeApi = new Hono();

homeApi.use('/:botId/:key/*', async (c, next) => {
  const { botId, key } = c.req.param();
  const want = Buffer.from(keyFor(botId)), got = Buffer.from(key);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return c.text('Not found', 404);
  c.header('Cache-Control', 'no-store');
  await next();
});

homeApi.get('/:botId/:key/', (c) => {
  const { botId, key } = c.req.param();
  const look = botLook(botId);
  return look ? c.html(render(look, `/bot-home/${botId}/${key}/`)) : c.text('Not found', 404);
});
homeApi.get('/:botId/:key/stamp', (c) => c.json({ stamp: String(botLook(c.req.param('botId'))?.stamp ?? ''), screen: null }));
homeApi.get('/:botId/:key/apps', (c) => c.json({ apps: [{ id: 'browser', name: 'Browser', kind: 'browser' }] }));
homeApi.get('/:botId/:key/icon', (c) => {
  const accent = botLook(c.req.param('botId'))?.colors?.accent ?? '#6b7280';
  return c.body(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="6" width="52" height="52" rx="14" fill="${accent}"/><text x="32" y="42" font-family="sans-serif" font-size="28" font-weight="600" text-anchor="middle" fill="#fff">B</text></svg>`, 200, { 'Content-Type': 'image/svg+xml' });
});
homeApi.get('/:botId/:key/favicon.svg', (c) => c.body(String(botLook(c.req.param('botId'))?.avatarSvg ?? ''), 200, { 'Content-Type': 'image/svg+xml' }));
homeApi.post('/:botId/:key/launch', (c) => c.json({ ok: false, error: 'no apps to launch here' }, 404));
