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

## Part status
| Part | What | Status |
|---|---|---|
| 0 | PARITY.md, mock API, screenshot workflow, baselines | IN PROGRESS (files pushed, first CI run pending) |
| 1 | Electron shell, local runtime, Hermes sidecar, app-data paths | TODO |
| 2 | Auth: single local user, per-install token | TODO |
| 3 | Bot screens: Chromium per bot, CDP screencast viewer | TODO |
| 4 | Composio -> local MCP servers, docs/local-tools.md, THIRD_PARTY.md | TODO |
| 5 | electron-builder + Actions matrix (win/mac/linux) | TODO |
| 6 | Verification report | TODO |

## Part 0 details
Files: `tests/parity/mock-api.mjs` (fixed data API + `/__signed-out`), `tests/parity/shoot.mjs` (Playwright, 1440x900, light and dark),
`tests/parity/compare.mjs` (hash compare, skipped while no baselines exist), `.github/workflows/parity.yml`, `docs/PARITY.md`.
Tested: nothing run yet (sandbox cannot run Chromium). Not tried: whether the real sidebar/modals match the aria-labels used in shoot.mjs.
Open sandbox state: a resize approval card was posted earlier; the user declined it. Ignore it.

## How to run / test
CI only: Actions > parity > Run workflow (`update_baselines=true` commits `docs/parity/`). Locally (real machine):
`npm ci; node tests/parity/mock-api.mjs & BOTHQ_API=http://127.0.0.1:8799 npm run dev -w web; node tests/parity/shoot.mjs out`.

## Known problems / not identical locally
See `docs/local-audit.md` (c). Note `server/src/env.ts` currently requires XAI/Composio/Orgo keys at import time.

## NEXT
Push, run workflow `parity`, fix until green, run once more with `update_baselines=true`, mark Part 0 DONE, tag `part-0-done`, open the draft PR, start Part 1.
