import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

/** A secret from NAME, or from the file named by NAME_FILE (so keys need not sit in .env). */
function secret(name: string): string {
  const direct = process.env[name];
  if (direct) return direct;
  const file = process.env[`${name}_FILE`];
  if (file) return fs.readFileSync(file, 'utf8').trim();
  throw new Error(`Missing env ${name} (or ${name}_FILE)`);
}

/**
 * SESSION_SECRET signs sessions, the agents' /mcp tokens and the owner sign-in key, so a guessable
 * one (the placeholder from .env.example, or anything short) would let anyone in.
 */
function sessionSecret(): string {
  const v = process.env.SESSION_SECRET || (LOCAL ? installSecret() : req('SESSION_SECRET'));
  if (/^change-me/i.test(v) || v.length < 16) {
    throw new Error('SESSION_SECRET is the example placeholder or too short. Set it to a long random value, e.g. `openssl rand -hex 32`.');
  }
  return v;
}

/**
 * Desktop mode (the Electron app sets BOTHQ_LOCAL=1): everything runs on this laptop. Data lives in
 * BOTHQ_DATA (the OS app-data folder), the server listens on 127.0.0.1 only, and nothing talks to Orgo.
 */
export const LOCAL = process.env.BOTHQ_LOCAL === '1';
const repoPath = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const dataDir = process.env.BOTHQ_DATA ?? repoPath('../../data');

/** Desktop mode: a random secret made on first run and kept (owner-only) in the app's data folder, so no one has to set one. */
function installSecret(): string {
  const file = path.join(dataDir, 'secret.key');
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { /* first run */ }
  const v = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, v, { mode: 0o600 });
  return v;
}

/** True for http(s)://localhost, 127.x.x.x and [::1] URLs. */
export function isLoopbackUrl(u: string): boolean {
  try {
    const h = new URL(u).hostname.replace(/^\[|\]$/g, '');
    return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
  } catch {
    return false;
  }
}

/** BOTHQ_<name>, or GROKBOT_<name> as set up before the project was renamed. */
export function compatEnv(name: string): string | undefined {
  return process.env[`BOTHQ_${name}`] ?? process.env[`GROKBOT_${name}`];
}

/** Default database file. One made before the rename (data/grokbot.db) keeps being used. */
function defaultDbPath(): string {
  const current = path.join(dataDir, 'bothq.db');
  const legacy = path.join(dataDir, 'grokbot.db');
  return !fs.existsSync(current) && fs.existsSync(legacy) ? legacy : current;
}

// Desktop mode never reads or writes ~/.hermes: the shared (read-only template) home is inside the app's own data folder.
const hermesHome = process.env.HERMES_HOME_PRIMARY ?? (LOCAL ? path.join(dataDir, 'hermes-shared') : path.join(os.homedir(), '.hermes'));
const appUrl = process.env.APP_URL ?? 'http://localhost:5173';

export const env = {
  local: LOCAL,
  dataDir,
  /** The built web app. In the desktop app it sits next to the server inside the package. */
  webDist: process.env.BOTHQ_WEB_DIST ?? repoPath('../../web/dist'),
  port: Number(process.env.PORT ?? 8787),
  /**
   * Interface to listen on. Unset = this machine only (127.0.0.1) while APP_URL is a local address,
   * so a development server is not offered to the whole network; otherwise every interface (what an
   * Orgo public URL needs). HOST, when set, always wins.
   */
  host: LOCAL ? '127.0.0.1' : process.env.HOST || (isLoopbackUrl(appUrl) ? '127.0.0.1' : undefined),
  appUrl,
  /** Public URL of this server, used for OAuth callbacks. */
  serverUrl: process.env.SERVER_URL ?? `http://localhost:${process.env.PORT ?? 8787}`,
  /** The app is only reachable at a local address (development). Some conveniences are limited to this. */
  localOnly: isLoopbackUrl(appUrl),
  /** Optional in desktop mode: without a key there is no call to xAI at all (x_search and voice stay off). */
  xaiKey: LOCAL ? (process.env.XAI_API_KEY ?? '') : req('XAI_API_KEY'),
  xaiModel: process.env.XAI_MODEL ?? 'grok-4.7',
  composioKey: LOCAL ? '' : req('COMPOSIO_API_KEY'),
  orgoKey: LOCAL ? '' : secret('ORGO_API_KEY'),
  sessionSecret: sessionSecret(),
  /** Email-only sign-in for testing. Honoured only when APP_URL is a local address (see routes.ts). */
  devLogin: process.env.DEV_LOGIN === '1' && isLoopbackUrl(appUrl),
  dbPath: process.env.DB_PATH ?? defaultDbPath(),

  // ---- Hermes engine ----
  /** The `hermes` CLI used to start a gateway for each extra bot. */
  hermesBin: process.env.HERMES_BIN ?? 'hermes',
  /** The primary bot's Hermes home and API server (an agent that already runs; never restarted by us). */
  hermesHome,
  hermesUrl: (process.env.HERMES_URL ?? 'http://127.0.0.1:8642').replace(/\/+$/, ''),
  hermesKey: process.env.HERMES_KEY ?? '',
  /** Where each extra bot's own Hermes home lives. Must be outside ~/.hermes so it is a separate tenant. */
  enginesDir: process.env.ENGINES_DIR ?? path.join(dataDir, 'engines'),
  enginePortBase: Number(process.env.ENGINE_PORT_BASE ?? 8650),
  /** URL the Hermes gateways use to reach this server's MCP endpoint. */
  mcpBaseUrl: (process.env.MCP_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8787}`).replace(/\/+$/, ''),
  /** Extra MCP servers every managed bot gets, as a JSON object of Hermes `mcp_servers` entries (e.g. X's XMCP). */
  extraMcpServers: process.env.EXTRA_MCP_SERVERS ?? '',
  primaryBotName: process.env.PRIMARY_BOT_NAME ?? 'Doug',
  primaryBotLabel: process.env.PRIMARY_BOT_LABEL ?? 'Chief of Staff',

  // ---- the one shared computer ----
  /** The Orgo computer every bot works on (one screen each). Empty = legacy one-box-per-user mode is not supported. */
  orgoComputerId: LOCAL ? '' : process.env.ORGO_COMPUTER_ID ?? '',
  /** This server runs on that computer, so shell commands run locally instead of through Orgo's API. */
  localBox: LOCAL || process.env.HQ_LOCAL === '1',
  /**
   * DevTools URL of a Chrome that already runs on the default screen and belongs to the primary bot
   * (e.g. http://127.0.0.1:9333). When set, we never start or stop that screen's Chrome ourselves.
   */
  primaryCdpUrl: process.env.PRIMARY_CDP_URL ?? '',
  /** Desktop mode: how to start one bot's browser (JSON {exe, args}, set by the desktop shell). Empty = no bot browsers. */
  browserCmd: LOCAL ? process.env.BOTHQ_BROWSER_CMD ?? '' : '',
  /** Bots that can each have a screen (Orgo allows four screens on one Linux computer). */
  maxBots: Number(process.env.MAX_BOTS ?? 4),
  /**
   * Comma-separated emails allowed to sign in. Empty = anyone, but only while APP_URL is a local
   * address; on a public URL an empty list lets nobody in, and a session whose address is not on
   * the list stops working (see routes.ts maySignIn, lib/auth.ts userFromToken).
   */
  allowedEmails: (process.env.ALLOWED_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  /**
   * The account of whoever runs the computer. Only its bots may be bound to the agent that already
   * lives there (the primary engine: that agent's memory, its messaging, the main screen). Unset =
   * any account while APP_URL is a local address (development), no account on a public URL (see
   * engine.ts mayUsePrimary).
   */
  ownerEmail: (process.env.OWNER_EMAIL ?? '').trim().toLowerCase(),
};

if (process.env.DEV_LOGIN === '1' && !env.devLogin) {
  console.warn('[env] DEV_LOGIN=1 is ignored because APP_URL is not a local address. Use scripts/sign-in-link.sh instead.');
}
if (!env.localOnly && !env.allowedEmails.length) {
  console.warn('[env] ALLOWED_EMAILS is empty and APP_URL is public: nobody can sign in with Google, and only sign-ins made with scripts/sign-in-link.sh keep working. Set ALLOWED_EMAILS to let people in.');
}
if (!env.localOnly && !env.ownerEmail) {
  console.warn("[env] OWNER_EMAIL is not set and APP_URL is public: no new bot is bound to the computer's own agent, each gets an agent of its own. Set OWNER_EMAIL to the account that should have it.");
}
