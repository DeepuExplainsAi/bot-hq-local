# Third-party code in the desktop app

Bot HQ is MIT-licensed (`LICENSE`). Icons and other notices are in `THIRD_PARTY_NOTICES.md`. This file logs the code the desktop app adds in the local-installer work. Only MIT, Apache-2.0 and BSD are allowed for the tool servers; `node scripts/licenses.mjs` re-checks the whole dependency tree of every one of them (last run: 280 packages, all permissive).

## Local tool servers (replace Composio, Part 4)

Each runs on the user's machine as a child process over stdio, started with the app's own Node. They are pinned npm dependencies of `server/`.

| App | Package | Version | License | LICENSE checked in | Upstream |
|---|---|---|---|---|---|
| GitHub | `@modelcontextprotocol/server-github` | 2025.4.8 | MIT | `package.json` field; the repository's LICENSE (MIT, Anthropic PBC) in modelcontextprotocol/servers-archived. The npm package ships no LICENSE file. | Archived and unmaintained upstream (npm deprecation notice) |
| Slack | `@modelcontextprotocol/server-slack` | 2025.4.25 | MIT | same as above | Deprecated upstream ("no longer supported") |
| Notion | `@notionhq/notion-mcp-server` | 2.6.1 | MIT | `LICENSE` in the package (Notion Labs, Inc.) | makenotion/notion-mcp-server |
| Linear | `@tacticlaunch/mcp-linear` | 1.4.6 | MIT | `LICENSE.md` in the package | community server (Linear's own MCP is hosted, so not allowed) |
| GitLab | `@zereight/mcp-gitlab` | 3.1.0 | MIT | `LICENSE` in the package | zereight/gitlab-mcp |
| (client) | `@modelcontextprotocol/sdk` | 1.x | MIT | `LICENSE` in the package (Anthropic PBC) | the app talks to the servers with it |

Transitive dependencies of these (280 packages in total): MIT 246, Apache-2.0 8, BSD-2/3-Clause 10, ISC 14, BlueOak-1.0.0 1, Unlicense 1. ISC, BlueOak and Unlicense are permissive and appear only as dependencies, never as a tool server.

## Candidates rejected

- Gmail: `@gongrzhe/server-gmail-autoauth-mcp` is ISC and needs an interactive Google sign-in; not used.
- Google Calendar / Drive: need the user to create a Google OAuth client and complete a browser sign-in; no acceptable server with a plain token. Listed as not available (docs/local-tools.md).
- Filesystem / fetch / memory: Hermes has its own file, web and memory tools.
