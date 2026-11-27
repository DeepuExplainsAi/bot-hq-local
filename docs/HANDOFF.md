# HANDOFF (read first; say "continue" = resume from the first part not DONE)

Full instructions: `docs/MASTER_PROMPT.md` (saved unchanged, plus the later rules). Audit: `docs/local-audit.md`. Parity: `docs/PARITY.md`.

## Goal and hard rules
Turn Bot HQ (MIT, fork of nickvasilescu/bot-hq) into a local desktop app (Electron; .exe/.dmg/.AppImage/.deb). UI, routes, API shapes,
DB schema and features must stay identical. 127.0.0.1 only, data in OS app-data, SQLite stays, no keys in git, no cloud/paid service.
Keep LICENSE and notices; log third-party code in THIRD_PARTY.md. Branch `local-installer` only (never main, never force-push,
never rewrite history). Never write huge files in one go. Tag each DONE part `part-N-done`. One draft PR from `local-installer`.

## Decisions (user answers)
- App-managed Hermes home in app-data. NEVER touch `~/.hermes`.
- Native Windows first for Hermes. If unreliable: report and wait. No silent WSL2/Docker. Port Linux-only shell/Python helpers to Node (or bundled Python), same behaviour.
- Electron's Chromium for bot browsers, one session partition per bot.
- x_search and voice only with the user's optional `XAI_API_KEY`: off by default, no xAI calls without it, no UI change.

## COMPUTE RULE (binding)
No paid upgrade. The sandbox (0.5 GB RAM, 1 vCPU, 2 GB disk; Chromium OOMs) is ONLY for editing, git and reading logs.
Everything heavy runs in GitHub Actions: Playwright, typecheck, build, tests, Electron builds, Hermes install test.
- ONE CI run per part (batch commits, push once). Failure: `gh run view --log-failed`, fix, retry; after two real attempts mark the part BLOCKED here.
- Daily checks on ubuntu only. Windows/macOS builds only at the final installer part.
- Workflow `parity` (push to local-installer, workflow_dispatch input `update_baselines`) uses npm and Playwright caches and cancel-in-progress.
- Do not run npm builds, Chromium or vite in the sandbox.

## Public repo (decision)
Repo is PUBLIC (free Actions). Full history scanned with gitleaks 8.30.1 + regex sweep before publishing: clean. NEVER commit secrets; re-scan before Part 5.
The earlier billing block ("recent account payments have failed") only affected the private repo.

## Part status
| Part | What | Status |
|---|---|---|
| 0 | PARITY.md, mock API, screenshot workflow, baselines | DONE once the compare run below is green (tag part-0-done) |
| 1 | Electron shell, local runtime, Hermes sidecar, app-data paths | TODO |
| 2 | Auth: single local user, per-install token | TODO |
| 3 | Bot screens: Chromium per bot, CDP screencast viewer | TODO |
| 4 | Composio -> local MCP servers, docs/local-tools.md, THIRD_PARTY.md | TODO |
| 5 | electron-builder + Actions matrix (win/mac/linux) | TODO |
| 6 | Verification report | TODO |

## Part 0 details
Files: `tests/parity/mock-api.mjs` (fixed-data API, `/__signed-out`, WS upgrades destroyed), `tests/parity/shoot.mjs` (Playwright 1440x900,
light+dark: chat, search, new-bot, connect-apps, bot-settings, details-hidden; plus sign-in), `tests/parity/compare.mjs` (sha256 compare with docs/parity),
`.github/workflows/parity.yml` (typecheck, build, screenshots, compare, artifact, optional baseline commit), `docs/PARITY.md`, `docs/parity/*.png` (13 baselines).
CI history (honest): run 1 blocked by billing (private repo) -> repo made public; run 2 cancelled by me (no timeouts); run 3 failed (mock lacked /api/voice/options,
screenshot script did not exit); run 4 green (13 shots); run 5 (workflow_dispatch update_baselines=true) green and committed the baselines.
Known baseline quirk: the details-panel screen preview shows "Couldn't reach Doug's screen" because the mock has no viewer. Part 3 should add a deterministic
frame to the mock and refresh the baselines on purpose (documented change, not a regression).
Not covered by screenshots yet: voice call bar, streaming/thinking states (fixtures=working), viewer large view, Library tab, group chat.

## How to run / test
CI only: Actions > parity > Run workflow (`update_baselines=true` commits `docs/parity/`). Locally (real machine):
`npm ci; node tests/parity/mock-api.mjs & BOTHQ_API=http://127.0.0.1:8799 npm run dev -w web; node tests/parity/shoot.mjs out`.

## Known problems / not identical locally
See `docs/local-audit.md` (c). Note `server/src/env.ts` currently requires XAI/Composio/Orgo keys at import time.

## NEXT
Part 1 (Electron shell). Keep CI to ONE run per part. Sandbox cannot run Electron/Chromium: verify via Actions (add an Electron smoke job on ubuntu with xvfb).
