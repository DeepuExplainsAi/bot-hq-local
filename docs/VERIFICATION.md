# Part 6: verification report

Verified commit: `5be4c8d` on `local-installer`. All runs on GitHub-hosted runners (nothing was run on a laptop).
Runs: parity 46002262087, desktop 46002262143, installers 46002262031 (all green).

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Fresh install, app starts | PASS | `tests/local/verify.mjs` step 1 (empty data folder, signed in as `me@localhost`); installers job on Windows, macOS (arm64), Linux: unpacked app `--smoke` prints `SMOKE OK` |
| 2 | Create a bot | PASS | verify step 2; smoke "creating a bot starts its own Hermes gateway" |
| 3 | Chat | PASS (fake engine) | verify step 3: message goes to a fake gateway's `/v1/responses`, streamed answer stored. The real Hermes with a real model was NOT run in CI |
| 4 | Bot browser screen in the viewer | PASS | verify step 4 and smoke (RFB, Tight JPEG, control click); installed app on all 3 OS prints `BOT BROWSER OK` (real Electron bot browser) |
| 5 | Routines / scheduler | PASS | verify step 5: the bot creates a routine through its `hq` MCP tool, the cron job fires and the turn reaches the gateway; `last_run_at` set |
| 6 | Restart keeps data | PASS | verify step 6: bot, chat, routine survive a quit and restart; the scheduler runs the routine again |
| 7 | No outbound calls to Orgo, Google, Composio, xAI | PASS | `tests/no-outbound.mjs` hook fails any non-loopback connection in smoke and verify (stderr checked); Electron smoke records every request of the page (`SMOKE OK` only if none left the machine) |
| 8 | Installers contain LICENSE, THIRD_PARTY.md, THIRD_PARTY_NOTICES.md | PASS | installers job step "Licenses are inside the package" |
| 9 | No secrets in git history | PASS | gitleaks 8.30.1, 54 commits, "no leaks found" (parity job) |
| 10 | Typecheck, build, security tests, UI parity | PASS | parity job: typecheck, build, security 51/51, smoke 28/28, verify 7/7, screenshots match |

## Part 7: real Hermes, no model (workflow `hermes-real`, run 46021312124)
`tests/local/hermes-real.mjs` runs the real first-run install from `desktop/hermes.cjs` (uv 0.13.10 -> Python 3.14 -> Hermes v0.23.4, into a temp app-data folder), writes a bot home (`.env`, `config.yaml`), starts `hermes gateway run --no-supervise` with the same command and environment as `server/src/engine.ts`, and checks the gateway. No API key, no model call, no WSL2, no Docker.

| OS (GitHub runner) | Install | Gateway `/health` | `/v1/models` right key / wrong key | `~/.hermes` untouched |
|---|---|---|---|---|
| Windows (native, windows-latest) | PASS, 87 s | PASS (`{"status":"ok","platform":"hermes-agent"}`) at 101 s | 200 / 401 | PASS |
| macOS (Apple silicon, macos-latest) | PASS, 23 s | PASS at 31 s | 200 / 401 | PASS |
| Linux (ubuntu) | PASS (`hermes` job in `desktop.yml`: install, `--version`, `gateway --help`) | not run by this test | - | PASS |

Limits: the test starts the gateway itself (same command and env as the server) rather than through the server's engine code, and it never calls a model, so tool use, the `hq` MCP link and the bot browser under real Hermes on Windows/macOS are still unproven. The server ran on Linux only (fake Hermes).

## Not verified (honest list)
- A real model turn through real Hermes (needs a user's key or subscription); the bot browser driven by real Hermes (`cdp_url`).
- The installer UIs themselves (.exe NSIS wizard, .dmg drag, .deb install): CI starts the unpacked app from the same build, it does not run the installers.
- macOS Intel build (only Apple silicon is built). Installers are unsigned (SmartScreen / Gatekeeper warn).
- Event routines, Gmail/Calendar/Drive, hosted sandbox: not available locally (see `docs/local-audit.md` (c)).

## Not identical locally (added to the audit at Part 6)
- Per-bot screen is the bot's own browser, not a Linux desktop; control mode does not forward Ctrl/Cmd editing shortcuts; no clipboard sync; cursor shape is noVNC's default; the bot browser window is never shown on the laptop.
- Home page of the bot browser lists only the "Browser" tile.
- Each bot's browser is a separate Electron process with its own profile and DevTools port (not one process with partitions).
- App tools (GitHub, GitLab, Slack, Notion, Linear) are brokered by the app's `hq` MCP server so approvals keep working; app logos are letter tiles.
- If the user logs out inside the app, only a restart signs in again.
