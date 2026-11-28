import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { env } from './env.js';
import type { Toolkit } from './types.js';

/**
 * Desktop mode's replacement for Composio: open-source MCP servers that run on this machine as child
 * processes (stdio), with the user's own token. They are npm dependencies of the app, started with the
 * app's own Node (Electron as Node), so the user needs nothing installed. Their tools reach the bots
 * through this app's MCP server ("hq"), so every action still goes through the approval cards.
 * Licenses: THIRD_PARTY.md. What is and is not available: docs/local-tools.md.
 */

interface Field { key: string; label: string; env: string; hint?: string }
interface Def {
  slug: string; name: string; description: string; categories: string[];
  fields: Field[];
  /** npm package and the file inside it that starts the server. */
  pkg: string; bin: string; args?: string[];
}

// Slugs have no underscore: a tool is named SLUG_action, and the app reads the app from the part before the first one.
const DEFS: Def[] = [
  { slug: 'github', name: 'GitHub', description: 'Repositories, issues, pull requests and code search.', categories: ['developer tools'],
    fields: [{ key: 'token', label: 'Personal access token', env: 'GITHUB_PERSONAL_ACCESS_TOKEN', hint: 'github.com → Settings → Developer settings → Personal access tokens' }],
    pkg: '@modelcontextprotocol/server-github', bin: 'dist/index.js' },
  { slug: 'gitlab', name: 'GitLab', description: 'Projects, issues, merge requests and pipelines.', categories: ['developer tools'],
    fields: [{ key: 'token', label: 'Personal access token', env: 'GITLAB_PERSONAL_ACCESS_TOKEN', hint: 'GitLab → Preferences → Access tokens (scope: api)' }],
    pkg: '@zereight/mcp-gitlab', bin: 'build/index.js' },
  { slug: 'slack', name: 'Slack', description: 'Read channels and post messages in your workspace.', categories: ['communication'],
    fields: [
      { key: 'token', label: 'Bot token (xoxb-…)', env: 'SLACK_BOT_TOKEN', hint: 'api.slack.com/apps → your app → OAuth & Permissions' },
      { key: 'team', label: 'Workspace ID (T…)', env: 'SLACK_TEAM_ID' },
    ],
    pkg: '@modelcontextprotocol/server-slack', bin: 'dist/index.js' },
  { slug: 'notion', name: 'Notion', description: 'Search, read and edit pages and databases.', categories: ['productivity'],
    fields: [{ key: 'token', label: 'Integration token', env: 'NOTION_TOKEN', hint: 'notion.so/profile/integrations → New integration; share pages with it' }],
    pkg: '@notionhq/notion-mcp-server', bin: 'bin/cli.mjs', args: ['--transport', 'stdio'] },
  { slug: 'linear', name: 'Linear', description: 'Issues, projects and teams.', categories: ['productivity', 'developer tools'],
    fields: [{ key: 'token', label: 'API key', env: 'LINEAR_API_TOKEN', hint: 'Linear → Settings → Security & access → Personal API keys' }],
    pkg: '@tacticlaunch/mcp-linear', bin: 'dist/index.js' },
];
const def = (slug: string) => DEFS.find((d) => d.slug === slug);

// ---------------------------------------------------------------- the user's tokens: one encrypted file

type Store = Record<string, Record<string, Record<string, string>>>; // user -> app -> field -> value
const storeFile = () => path.join(env.dataDir, 'tools.enc');
const storeKey = () => crypto.createHmac('sha256', env.sessionSecret).update('tools-store').digest();

function readStore(): Store {
  try {
    const raw = Buffer.from(fs.readFileSync(storeFile(), 'utf8'), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', storeKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
  } catch { return {}; }
}
function writeStore(s: Store) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', storeKey(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(s), 'utf8'), c.final()]);
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), Buffer.concat([iv, c.getAuthTag(), body]).toString('base64'), { mode: 0o600 });
}

// ---------------------------------------------------------------- catalog and connections

export type CatalogItem = Omit<Toolkit, 'connected'>;
export const localCatalog = (): CatalogItem[] => DEFS.map((d) => ({ slug: d.slug, name: d.name, description: d.description, categories: d.categories, managedAuth: false, noAuth: false }));
export const localConnected = (userId: string): Set<string> => new Set(Object.keys(readStore()[userId] ?? {}).filter((s) => def(s)));
export const localFields = (slug: string) => def(slug)?.fields.map(({ key, label, hint }) => ({ key, label, hint }));

// ---------------------------------------------------------------- the running servers

interface Running { client: Client; tools: { name: string; real: string; description: string; inputSchema: any }[] }
const running = new Map<string, Promise<Running>>();
const id = (userId: string, slug: string) => `${userId}\0${slug}`;

/** The start file of a tool server: found by walking up the node_modules folders (a package's `exports` may hide its package.json from require). */
function binPath(d: Def): string {
  for (let dir = path.dirname(fileURLToPath(import.meta.url)); ; dir = path.dirname(dir)) {
    const file = path.join(dir, 'node_modules', d.pkg, d.bin);
    if (fs.existsSync(file)) return file;
    if (dir === path.dirname(dir)) throw new Error(`${d.name} is not installed (${d.pkg})`);
  }
}

async function start(d: Def, values: Record<string, string>): Promise<Running> {
  const secrets = Object.values(values).filter((v) => v.length > 3);
  const redact = (s: string) => secrets.reduce((t, v) => t.split(v).join('…'), s);
  const childEnv: Record<string, string> = { ...getDefaultEnvironment(), ELECTRON_RUN_AS_NODE: '1' };
  for (const f of d.fields) childEnv[f.env] = values[f.key] ?? '';
  const transport = new StdioClientTransport({ command: process.execPath, args: [binPath(d), ...(d.args ?? [])], env: childEnv, stderr: 'pipe' });
  let said = '';
  transport.stderr?.on('data', (b: Buffer) => { said = (said + b.toString()).slice(-600); });
  const client = new Client({ name: 'bothq', version: '1' });
  try {
    await client.connect(transport, { timeout: 30_000 });
    const listed = await client.listTools(undefined, { timeout: 30_000 });
    const prefix = d.slug.toUpperCase();
    return {
      client,
      tools: listed.tools.map((t) => ({ name: `${prefix}_${t.name}`, real: t.name, description: `[${d.name}] ${t.description ?? ''}`.trim(), inputSchema: t.inputSchema })),
    };
  } catch (e: any) {
    await client.close().catch(() => {});
    throw new Error(redact(`${d.name} did not start: ${e?.message ?? e}${said ? ` (${said.trim().split('\n').pop()})` : ''}`));
  }
}

function serverFor(userId: string, slug: string): Promise<Running> {
  const d = def(slug);
  const values = readStore()[userId]?.[slug];
  if (!d || !values) return Promise.reject(new Error(`${slug} is not connected`));
  let p = running.get(id(userId, slug));
  if (!p) {
    p = start(d, values);
    running.set(id(userId, slug), p);
    p.catch(() => running.delete(id(userId, slug))); // try again on the next call
  }
  return p;
}

async function stop(userId: string, slug: string) {
  const p = running.get(id(userId, slug));
  running.delete(id(userId, slug));
  await p?.then((r) => r.client.close(), () => {});
}

/** Save the user's token(s) for an app and start its server, to prove they work. Nothing is kept if it does not start. */
export async function localConnect(userId: string, slug: string, values: Record<string, string>): Promise<void> {
  const d = def(slug);
  if (!d) throw new Error(`Unknown app "${slug}"`);
  const clean: Record<string, string> = {};
  for (const f of d.fields) {
    const v = String(values[f.key] ?? '').trim();
    if (!v) throw new Error(`${f.label} is required`);
    clean[f.key] = v;
  }
  await stop(userId, slug);
  const check = await start(d, clean); // throws with a readable reason
  const store = readStore();
  store[userId] = { ...store[userId], [slug]: clean };
  writeStore(store);
  running.set(id(userId, slug), Promise.resolve(check));
}

export async function localDisconnect(userId: string, slug: string): Promise<void> {
  await stop(userId, slug);
  const store = readStore();
  if (store[userId]) { delete store[userId][slug]; writeStore(store); }
}

/** OpenAI-function-format tools of every connected app (a server that will not start is skipped and logged). */
export async function localTools(userId: string): Promise<any[]> {
  const out: any[] = [];
  for (const slug of localConnected(userId)) {
    try {
      for (const t of (await serverFor(userId, slug)).tools) out.push({ type: 'function', name: t.name, description: t.description, parameters: t.inputSchema });
    } catch (e: any) { console.warn(`[tools] ${e?.message ?? e}`); }
  }
  return out;
}

export async function localExecute(userId: string, name: string, args: Record<string, unknown>): Promise<{ data?: unknown; error?: unknown; resultType?: string; logId?: string }> {
  const slug = name.split('_')[0].toLowerCase();
  const server = await serverFor(userId, slug);
  const tool = server.tools.find((t) => t.name.toUpperCase() === name.toUpperCase());
  if (!tool) return { error: `${name} is not a tool of ${slug}` };
  const r: any = await server.client.callTool({ name: tool.real, arguments: args }, undefined, { timeout: 120_000 });
  const text = (r.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
  if (r.isError) return { error: text || 'the tool failed', resultType: 'error' };
  let data: unknown = text;
  try { data = JSON.parse(text); } catch { /* plain text */ }
  return { data: r.structuredContent ?? data, resultType: 'completed' };
}

export async function stopLocalTools(): Promise<void> {
  const all = [...running.values()];
  running.clear();
  await Promise.all(all.map((p) => p.then((r) => r.client.close(), () => {})));
}
