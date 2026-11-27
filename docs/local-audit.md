# Local audit: Bot HQ cloud dependencies and their local replacements

Status: STEP 0 only. No code has been changed. Source: `nickvasilescu/bot-hq` (17 commits, copied into this repo).

## License check

`LICENSE` is **MIT** (Copyright 2026 Nick Vasilescu). Allowed. Keep it and `THIRD_PARTY_NOTICES.md`
(Lucide ISC and Feather MIT are already listed there). The GitHub wiki of the source repo is not
public (the wiki URL redirects), so the README, `docs/ARCHITECTURE.md` and the code were the sources.
`docs/orgo-builder-guide.md` and `docs/xai-and-composio.md` are vendor guides and are not needed locally.

Hermes Agent (NousResearch/hermes-agent) is MIT. Native Windows is documented as supported
(PowerShell installer, `%LOCALAPPDATA%\hermes`), also WSL2. It currently targets Python 3.14.

## (a) Cloud dependencies, (b) local replacement

| # | Dependency | Where | Local replacement |
|---|---|---|---|
| 1 | **Orgo computer API** (`ORGO_API_KEY`, `ORGO_COMPUTER_ID`): wake/resume the VM, list/create/delete screens (max 4), screenshots, click/type/key, bash, file export | `server/src/orgo.ts`, `computer.ts`, `box.ts`, `routes.ts` (`/computer*`, `/bots/:id/screenshot`), `routes-config.ts` (file export) | No computer to wake: `ensureComputer` returns "running". `box.bash`/`writeFile`/`readFile` already have a local mode (`HQ_LOCAL=1`), so it is forced on. Screenshots come from CDP `Page.captureScreenshot`. `orgo.ts` is no longer called. |
| 2 | **Per-bot screen = X display + VNC** (`:99`, `:100`..., `displayFor`, 4-screen cap, VNC password from Orgo) | `computer.ts`, `desk.ts`, `vnc.ts`, `lib/des.ts`, `web/.../ComputerViewer.tsx` (noVNC) | One isolated Chromium per bot (own `--user-data-dir`, own `--remote-debugging-port`). The viewer shows it through CDP screencast, served over the same `/api/.../vnc` WebSocket path. See "not identical" (1). |
| 3 | **Desk scripts** dressing screens: wallpaper, dock, GTK theme, xfce panels, window manager, private D-Bus, Chrome policy dir `/etc/opt/chrome/policies`, home-screen extension | `server/box/hq-screen.py`, `hq-shell.py`, `hq-home.py`, `hqlib.py`, `home.html`, `ext/*`; `desk.ts` copies them to `/opt/hq` | The Linux-desktop parts are dropped. The home page (`home.html` + newtab extension) is kept as each bot Chromium's new-tab page, loaded with `--load-extension`, so that part looks the same. |
| 4 | **`/opt/hq`, `/root/bothq`, `/root/grokbot`, `/var/log/hq`, `/etc/...`** paths | `desk.ts` (`ROOT`), `paths.ts`, `box.ts` (`HOME=/root`), `hqlib.py`, `engine.ts` | OS app-data folder (`app.getPath('userData')`): `data/bothq.db`, `engines/<bot>`, `profiles/<bot>`, `files/<bot>`, `logs`. Passed to the server as env (`DB_PATH`, `ENGINES_DIR`, `BOTHQ_DATA`). |
| 5 | **supervisor + `install-on-computer.sh`, `pack.sh`, `sign-in-link.sh`, `add-hq-to-hermes.py`** | `scripts/*` | Electron main process: starts the server, starts and restarts Hermes gateways, stops them on quit. Scripts are not shipped. `add-hq-to-hermes.py` logic (add `mcp_servers.hq`) is done by the app for the first bot's Hermes home. |
| 6 | **`PUBLIC_URL` / Orgo public URL / `APP_URL` / `SERVER_URL`**, HOST=all interfaces on a public URL | `env.ts`, `lib/auth.ts` (origin checks, secure cookie) | Server binds `127.0.0.1` on a free port. `APP_URL = SERVER_URL = http://127.0.0.1:<port>`. The same-origin/CSRF check stays and is satisfied by that origin. |
| 7 | **Google sign-in through Composio**, `ALLOWED_EMAILS`, `OWNER_EMAIL`, sessions, `DEV_LOGIN`, owner key, sign-in links, rate limits | `routes.ts` `/auth/*`, `composio.ts` (`startGoogleLogin`, `googleProfile`), `lib/auth.ts`, `web/.../SignIn.tsx`, `env.ts`, `db.ts` | Single local user (fixed row in `users`, so the DB schema is unchanged). Electron sets the session cookie before loading the page, from a random per-install token kept in the OS keychain (`safeStorage`). `/api/auth/me` therefore returns the user and the sign-in page is never shown. `/api/auth/google/*` is removed. Loopback + token is the trust. |
| 8 | **Composio hosted tools**: catalog (`backend.composio.dev`), connect links and OAuth, per-user sessions, tool execution, approvals, triggers (realtime subscription), Gmail connect | `composio.ts`, `triggers.ts`, `mcp.ts`, `agent/tools.ts`, `agent/loop.ts`, `routes.ts` `/apps*`, `web/.../ConnectAppsModal.tsx`, `ToolkitLogo.tsx`, `db.ts` `composio_sessions` | Step 4: local MCP servers (below). |
| 9 | **xAI** (`api.x.ai`): `x_search`, realtime voice, TTS preview, dictation | `voice.ts`, `agent/tools.ts` | Kept. It is the user's own `XAI_API_KEY` and a feature the app already supports, not Orgo/Google/Composio. The key moves from `.env` to the keychain. Without a key, `x_search` and voice are disabled; `env.ts` currently throws if keys are missing, so these become optional. |
| 10 | **Hermes primary engine** (an agent "already running on the computer", `HERMES_URL :8642`, `~/.hermes`) | `engine.ts`, `env.ts` | The primary bot becomes a Hermes home in app-data, started and supervised by the app like the managed ones. The "never restart" rule is dropped because the app owns it. (Decision needed, see questions.) |
| 11 | **Hermes itself** (Python) | external | Sidecar installed on first run into app-data (uv + pinned Hermes release), with a progress screen. |
| 12 | **Model providers** used by Hermes (Anthropic, OpenAI, xAI, subscription sign-ins) | Hermes config | Kept. User's own keys/subscriptions. Subscription sign-in currently opens a terminal on the bot's X screen (`routes-config.ts`, `hq-shell.py`): locally it opens in the bot's own browser window / system terminal. |
| 13 | **Telemetry / analytics / CDN fonts** | whole repo | None found (grep for posthog, sentry, gtag, segment, telemetry, external fonts/CDNs: nothing). Hermes may have its own; the sidecar will be started with its telemetry off if it has a switch. |
| 14 | **`tests/no-outbound.mjs`** | tests | Reused for Step 6 proof, extended with Orgo, Google, Composio hosts. |

## Composio usage (for Step 4)

Composio is generic: it exposes a catalog of hundreds of toolkits, and each user connects what they want.
Nothing in the code is pinned to a fixed list, so the actual set of tools is whatever the user connected.
Where it is used:

- Every bot: `mcp.ts` adds `composioTools(user)` to every bot's `/mcp/<bot>` (primary and managed). Meta tools: `COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_GET_TOOL_SCHEMAS` (no approval), `COMPOSIO_MULTI_EXECUTE_TOOL`, `COMPOSIO_REMOTE_WORKBENCH`, `COMPOSIO_REMOTE_BASH_TOOL` (hosted sandbox), and per-action tools (approval card each).
- `request_app_connection` tool (bot asks the user to connect an app) and the Connect Apps modal / sidebar.
- Event routines: Composio triggers, e.g. `GMAIL_NEW_GMAIL_MESSAGE`, `SLACK_RECEIVE_MESSAGE`, `GITHUB_PULL_REQUEST_EVENT` (`triggers.ts`).
- Examples named in code and prompts: gmail, googlecalendar, slack, github, notion, linear.
- Sign-in (Google) uses a temporary Composio connection. Removed with item 7.

Proposed local MCP servers (to be license-checked at Step 4, only MIT/Apache-2.0/BSD):

| Toolkit | Candidate local stdio server | License to verify |
|---|---|---|
| github | `github/github-mcp-server` (user PAT) | MIT |
| slack | `modelcontextprotocol/servers` Slack (archived) or `korotovsky/slack-mcp-server` | MIT |
| notion | `makenotion/notion-mcp-server` (user integration token) | MIT |
| linear | Linear's own MCP is hosted (not allowed); a community stdio server is needed | to verify |
| gmail / google calendar / drive | `taylorwilsdon/google_workspace_mcp` (user's own Google OAuth client) | MIT |
| filesystem / fetch / memory (replaces the Composio sandbox) | `modelcontextprotocol/servers` | MIT |

Anything with no acceptable local server is listed as "not available locally" at Step 4. No cloud call is left behind.

## (c) What cannot be kept identical locally

1. **A full Linux desktop per bot.** The cloud viewer shows a real X desktop (wallpaper, dock, window manager, file manager, terminal, other apps) and lets the user take control of it. Locally the viewer shows the bot's own Chromium only (CDP screencast, with mouse/keyboard forwarded through CDP `Input.*`). Not identical: desktop apps other than the browser, the dock, the "launch app/terminal/files" actions, and Hermes' "Bot Desktop" feature. The viewer component and its look are kept; the wire protocol changes from RFB to CDP, so `novnc` is replaced inside `ComputerViewer.tsx` by a canvas fed by the same socket path. Clipboard sync is limited to text.
2. **Four-screen cap** (Orgo limit) goes away; `MAX_BOTS` still applies as the app's own limit.
3. **Composio breadth and managed OAuth.** Composio's catalog is hundreds of apps with one-click OAuth. Locally each tool needs its own key or OAuth client created by the user, and only the apps with a good MIT/Apache/BSD stdio server are available. The Connect Apps UI stays; the catalog it shows becomes the list of local servers.
4. **Event routines (triggers).** Composio pushes events over a hosted subscription. A laptop has no public webhook, so push triggers are not available locally. Polling inside a local MCP server is a possible replacement and is flagged per tool. Cron routines are unaffected.
5. **Always-on.** The cloud computer runs 24/7. Routines, check-ins and the primary bot's messaging channels (iMessage, Telegram) only work while the laptop is awake and the app is running. Missed cron runs are not replayed unless the existing scheduler already does so.
6. **Hosted sandbox tools** (`COMPOSIO_REMOTE_WORKBENCH`/`REMOTE_BASH_TOOL`) are removed. Hermes' own local terminal tool covers the use, but it runs on the user's real machine, not in a sandbox.
7. **Windows**: Hermes supports native Windows, but the app's Python and shell helpers (`hqlib.py`, `bash -c` in `box.ts`, `/proc` scanning) are Linux-only. The Linux desktop parts are dropped (item 1), and `box.bash` has to use `cmd`/PowerShell or be bypassed there. It is the riskiest platform; macOS and Linux are lower risk.
8. **Signed installers**: unsigned builds show SmartScreen / Gatekeeper warnings (accepted).

## Proposed plan and size

Steps 1 to 6 as in your brief. Expected touch points: `env.ts`, `paths.ts`, `box.ts`, `computer.ts`, `desk.ts`, `vnc.ts`, `routes.ts` (auth, computer, apps), `routes-config.ts`, `composio.ts` and `triggers.ts` (replaced by an MCP registry), `ComputerViewer.tsx` (transport only), `SignIn.tsx` (no longer reached), plus a new `desktop/` Electron package. No CSS, routes, API shapes or DB schema change.

## Questions before Step 1

1. **Primary bot**: today it is "the Hermes agent already on the computer". Locally, OK to make it a normal app-managed Hermes home in app-data (not your own `~/.hermes`)? Recommended.
2. **Windows**: OK to try native Windows Hermes first, with WSL2 not required, and report if it is unreliable?
3. **Chromium**: OK to use the Chromium bundled in Electron for bot browsers (smaller installer), rather than downloading a separate Chrome?
4. **xAI**: keep `x_search` and voice with your own `XAI_API_KEY` (optional)?

## Step 4 outcome

Done in Part 4: see `docs/local-tools.md` and `THIRD_PARTY.md`. Gmail, Calendar and Drive ended up "not available locally"; the other proposed servers were replaced by the ones logged in THIRD_PARTY.md (the Slack server is the modelcontextprotocol one, not korotovsky's, which ships a Go binary).
