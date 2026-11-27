# MASTER PROMPT (saved unchanged). Two parts: the original brief, then the follow-up that answers the audit questions and sets the workflow.

## Part A: original brief

You are working in my GitHub repo, which is a copy of
https://github.com/nickvasilescu/bot-hq ("Bot HQ", formerly Grokbot).

GOAL: The app must look and work EXACTLY as it does now. Change ONLY the
parts that run on a cloud server / cloud computer so they run on my own
laptop, then package it as a normal installer app (Windows .exe, macOS .dmg,
Linux .AppImage/.deb). Nothing else.

STEP 0 - Read first, change no code
- Read README, wiki and LICENSE. If the license is missing or is not
  MIT / Apache-2.0 / BSD, STOP and tell me.
- Write docs/local-audit.md listing: (a) every cloud dependency (Orgo
  computer API and ORGO_COMPUTER_ID, PUBLIC_URL / public tunnel, Google
  sign-in with ALLOWED_EMAILS / OWNER_EMAIL, supervisor and
  install-on-computer.sh, /opt/hq and /root paths, per-bot VNC/X-display
  screens, Composio or any hosted API, telemetry); (b) the local
  replacement for each; (c) anything that cannot be kept identical locally.
- Then STOP and wait for my OK.

HARD RULES
- Do NOT change UI, layout, colors, text, routes, API shapes, DB schema or
  bot features. No refactors, no redesign. Smallest possible diff.
- No cloud server, no paid service, no new login. Only my own API keys and
  subscriptions that the app already supports.
- Everything listens on 127.0.0.1 only. Data lives in the OS app-data
  folder (SQLite stays SQLite). Never commit keys.
- Keep LICENSE and notices. Log third-party code in THIRD_PARTY.md.
- Work in small steps, commit after each. Never write a huge file in one
  go; build big files in parts and check nothing is cut off.
- After each step: run the app, test it, report honestly, then wait.

STEP 1 - Local runtime (replaces Orgo computer + supervisor)
- Add an Electron shell. Its main process starts the Node/Hono server on a
  free loopback port, starts the Hermes engine gateway(s) as child
  processes, restarts them if they crash, and stops them on quit.
- Replace /opt/hq and /root paths with app-data paths.
- Hermes is Python: set it up as a self-contained sidecar on first run
  (for example with uv, into app-data, with a progress screen). If native
  Windows is unreliable, tell me the options. Do not silently require
  Docker or WSL.

STEP 2 - Auth
- Remove the Google sign-in and the public URL. The app is single-user and
  local: trust loopback plus a random per-install token. The sign-in page
  is skipped; no other UI changes.

STEP 3 - Bot screens
- Cloud version: each bot has its own screen (VNC) on the cloud computer.
  Local version: each bot gets its own isolated Chromium (separate
  profile) and the existing viewer shows it (CDP screencast), keeping the
  viewer component and its protocol as close as possible.
- If a feature needs a full Linux desktop per bot, list it in the audit as
  "not identical". Do not fake it.

STEP 4 - Replace Composio (hosted tools) with local MCP servers
- In the audit, list every tool/integration that currently goes through
  Composio or any hosted connector, and which bots/features use it.
- For each one, pick an open-source MCP server that runs locally as a child
  process (stdio) on the user's laptop. Allowed licenses only: MIT,
  Apache-2.0, BSD. Check each LICENSE and log it in THIRD_PARTY.md.
- Register them through the Hermes engine's existing mcp_servers config,
  the same way the app's own hq tools are added. No new UI: if the app
  already has a place to enable tools, reuse it.
- Auth is local only: the user's own API key or OAuth client, stored in the
  OS keychain or an encrypted local file. Never in git or logs.
- If no good local server exists for a tool, list it as "not available
  locally" in the audit. Do not fake it or leave a cloud call behind.
- Add a short docs/local-tools.md: how to add one more MCP server.

STEP 5 - Installer
- electron-builder + GitHub Actions matrix (windows, macos, ubuntu).
  Outputs: .exe, .dmg, .AppImage/.deb. Unsigned is fine. Ship
  THIRD_PARTY.md and LICENSE inside the installer.

STEP 6 - Verify (report each item pass/fail)
Fresh install, app starts, create a bot, chat, bot browser screen shows in
the viewer, routines/scheduler run, restart keeps data, and NO outbound
calls to Orgo, Google or Composio.

https://github.com/nickvasilescu/bot-hq.git

Create on completely new repo. And use this repo and modify according to my prompt.

## Part B: follow-up (answers to the audit questions, workflow, quality gates)

OK to all four, with these conditions:
1) Yes: app-managed Hermes home in app-data. Never touch my ~/.hermes.
2) Yes: try native Windows first. If it is unreliable, report it and wait.
   Do NOT silently fall back to WSL2 or Docker. Port the Linux-only shell
   and Python helpers to cross-platform Node (or bundled Python), keeping
   the same behavior.
3) Yes: Electron's Chromium for bot browsers, one separate session
   partition per bot so logins and cookies never mix.
4) Yes: keep x_search and voice, only with my own optional XAI_API_KEY.
   Off by default, no calls to xAI unless I add the key, no UI change.
Proceed to Step 1.

WORKFLOW (overrides any earlier "stop and wait" lines)

Work on branch `local-installer`. Do the steps in order, ONE PART AT A TIME,
and do NOT ask me before moving to the next part. After EVERY part:
1. Run the app/build and test that part.
2. Commit with a clear message (never include secrets) and push.
3. Update docs/HANDOFF.md, commit and push again.
4. Immediately start the next part.

docs/HANDOFF.md must let a brand-new AI with NO chat history continue.
Keep it current with:
- Goal and hard rules (short summary of this prompt)
- Decisions already made, including my answers: app-managed Hermes home
  (never touch ~/.hermes); try native Windows first, no silent WSL2/Docker;
  Electron's Chromium with one session per bot; x_search/voice only with
  my optional XAI_API_KEY
- Status of every part: DONE / IN PROGRESS / BLOCKED
- What changed (files), what was tested, what failed
- How to run, build and test
- Known problems, "not identical locally" items, and the exact NEXT step

If I (or another AI) say "continue": read docs/HANDOFF.md first and resume
from the first part that is not DONE.

Stop and ask me ONLY if: the license is not MIT/Apache-2.0/BSD, a part is
blocked after two real attempts, or a choice would change the UI or
features. Never force-push. Never rewrite history. If something is unclear,
choose the safest smallest option, write it in HANDOFF.md and keep going.

QUALITY GATES (add to the workflow above)

PART 0 (before any change): create docs/PARITY.md = a checklist of every
screen, route and feature as it works NOW, plus baseline screenshots of
each screen (Playwright) in docs/parity/. Commit and push. This is the
definition of "looks and works the same".

AFTER EVERY PART, a part is DONE only if ALL of these pass:
1. typecheck and build pass
2. existing tests pass, and you added a smoke test for this part
3. the PARITY checklist items touched by this part still pass, and new
   screenshots match the baselines (no UI diff)
4. GitHub Actions is green on the pushed commit (add a CI workflow that
   runs typecheck, build, tests and the smoke test on every push)
If a check fails: fix it. After two real attempts, mark the part BLOCKED
in docs/HANDOFF.md with the exact error and stop.

CHECKPOINTS: after each DONE part, tag it (git tag part-N-done) and push
the tag, so I can roll back to any part.

SCOPE: keep each part small. If a part touches more than about 15 files,
split it into sub-parts first and write the split in HANDOFF.md.

REPORTING: never write "tested" or "passing" unless you actually ran it.
In HANDOFF.md include the exact commands run and their results.
Do not touch main. Open one draft pull request from `local-installer` so I
can see all commits.
FIRST ACTION: save this entire prompt, unchanged, as docs/MASTER_PROMPT.md
and commit it. HANDOFF.md must point to it.

## Part C: compute rule (added later, overrides anything above)

Do NOT approve the machine resize and do not use any paid upgrade.
Keep the sandbox only for editing code, git and reading logs.
Run everything heavy in GitHub Actions: Playwright baseline screenshots,
typecheck, build, tests, Electron builds, Hermes install test.

Part 0 now:
- Add a workflow with workflow_dispatch + push to `local-installer`:
  start tests/parity/mock-api.mjs and the app, take baseline screenshots
  with Playwright, upload them as an artifact AND commit them to
  docs/parity/ (only when run with an input `update_baselines=true`).
- Cache npm and Playwright browsers. Use concurrency with
  cancel-in-progress. Run daily checks on ubuntu only. Run windows/macos
  builds only at the final installer part, to save free minutes.
- Do ONE CI run per part (batch your changes), not one per commit.
- If a CI run fails, read it with `gh run view --log-failed`, fix, retry.
  After two real attempts mark the part BLOCKED in docs/HANDOFF.md.
- Add this rule to docs/HANDOFF.md and docs/MASTER_PROMPT.md, then
  continue Part 0 and the remaining parts automatically.

## Part D: public repo decision

Option 1 chosen: the repo is made public so GitHub-hosted Actions runners are free. Before that the ENTIRE git history
(21 commits) was scanned with gitleaks 8.30.1 plus a regex sweep: no secrets (only the `change-me` placeholder in `.env.example`).
Never commit secrets from now on (keys, tokens, .env, private keys, real databases). Scan again with gitleaks before the final installer part.
