# PARITY: what "looks and works the same" means

Baseline = the app as in upstream `nickvasilescu/bot-hq` at the fork point (commit `4b81dfc`), served against the
deterministic mock API `tests/parity/mock-api.mjs`. Screenshots live in `docs/parity/` (made by CI, see
`.github/workflows/parity.yml`; refresh with workflow_dispatch `update_baselines=true`). Screens (light and dark each):
`chat`, `search`, `new-bot`, `connect-apps`, `bot-settings`, `details-hidden`; plus `sign-in` (signed out).

Local-only expected differences are listed in `docs/local-audit.md` section (c). Anything else is a regression.

## Screens (UI must be pixel-identical except where the audit says otherwise)
- [ ] Sign-in page (skipped locally; page file stays)
- [ ] Sidebar: bot list, avatars, unread, pinned, New Bot, Search, Connect apps, collapse (Cmd/Ctrl+B)
- [ ] Chat: messages, markdown, streaming reply, thinking chip with timer and steps, "Worked for" chip, cards (approval, question, connect, draft), events, notices
- [ ] Composer: send, interrupt, dictation button
- [ ] Details panel: screen preview, activity, tasks, Library, engine; show/hide
- [ ] Computer viewer: watch / control modes, large view, reset screen, who is using the screen, hand back
- [ ] Bot settings: profile, effort, type, memories, skills, routines, tasks, engine (provider/model/sign-in/restart), voice
- [ ] Create bot, group chat (rooms) create and members
- [ ] Search modal (Cmd/Ctrl+K)
- [ ] Connect apps modal and per-bot app connect card
- [ ] Voice call bar and voice settings
- [ ] Library: list, open folder, download

## Features and routes (API shapes unchanged)
- [ ] `GET /api/auth/me` returns the user; logout
- [ ] Bots CRUD, primary, fresh conversation, read marker
- [ ] Rows + SSE `/api/events` (row upserts, live state, roster, computer state)
- [ ] Turns: `/v1/responses` streaming to Hermes, serial queue per bot, interrupt
- [ ] MCP `/mcp/<bot>`: x_search, save_file, routines, tasks, check-ins, send_to_bot, group chats, ask_user, request_app_connection
- [ ] Approvals: allow / always / deny, policies list and delete
- [ ] Routines: cron, run now, enable/disable, delete; check-ins
- [ ] Tasks, memories (view/delete), skills (CRUD)
- [ ] Computer: `/api/computer`, `/computer/ensure`, `/computer/suspend`, details, per-bot screenshot, screen reset, handback
- [ ] Viewer socket (`/api/.../vnc`) watch drops input
- [ ] Apps: catalog, connect, callback, disconnect
- [ ] Files: list, download, raw
- [ ] Voice: session mint, TTS preview, dictation
- [ ] Data persists across restarts (SQLite)
