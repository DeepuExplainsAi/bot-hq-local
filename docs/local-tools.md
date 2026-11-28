# Apps and tools in the desktop app

The desktop app has no Composio. Connected apps are open-source MCP servers that run on this computer.

## What is available

| App | Needs | Notes |
|---|---|---|
| GitHub | personal access token | repos, issues, PRs, code search |
| GitLab | personal access token (scope `api`) | projects, issues, merge requests |
| Slack | bot token (`xoxb-…`) and workspace ID | read channels, post messages |
| Notion | integration token | share the pages with the integration |
| Linear | API key | issues, projects, teams |

Not available on this computer: Gmail, Google Calendar, Google Drive (no MIT/Apache/BSD server that works with a plain token; each needs the user's own Google OAuth client and a browser sign-in), and the hundreds of other apps in Composio's catalog. Event routines ("whenever X happens in an app") are off, because a laptop has no public address to receive events; the bot says so and offers a scheduled routine. The hosted sandbox tools (Composio's workbench/bash) are gone; Hermes' own terminal tool runs on this computer.

## How it works

- Connect Apps shows the five apps. Connect opens a small window of the app's own page (`/api/apps/local-connect`) that asks for the token, starts the server to prove the token works, and only then saves it. No sign-in with a third party is involved.
- The token is stored in `<app data>/tools.enc`: AES-256-GCM, the key derived from the install secret (`secret.key`), file mode 600. It is not in git, not in the bots' config files and not in logs (the start error messages have it removed).
- The servers are npm dependencies of the app (pinned in `server/package.json`, licenses in `THIRD_PARTY.md`) and run with the app's own Node, so nothing has to be installed. They start the first time a bot needs them and stop when the app quits.
- Their tools reach the bots through the app's own MCP server ("hq"), named `APP_action` (for example `GITHUB_create_issue`). So the existing approval cards still apply: every app action asks first, "Always allow" and "Block" are kept per tool. (Registering the servers directly in Hermes' `mcp_servers` would skip the approvals, so it was not done.)
- Disconnecting deletes the token and stops the server.

## Adding another app

Add an entry to `DEFS` in `server/src/localtools.ts` (slug without underscore, fields, npm package and its start file), add the package to `server/package.json`, run `node scripts/licenses.mjs`, and log it in `THIRD_PARTY.md`. Only MIT, Apache-2.0 or BSD servers that run over stdio with a user-owned key.
