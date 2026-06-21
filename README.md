# note-mcp

Unofficial stdio MCP server for note.com. It uses cookie-based access to note.com's internal APIs.

> [!WARNING]
> This project is unofficial and not affiliated with note.com. Internal APIs can change without notice. Keep cookies local and never commit them to GitHub, npm, logs, or issue reports.

## Install / run

```bash
npx note-mcp
```

For advanced/server setups, you can still provide a Cookie header through the environment:

```bash
NOTE_COOKIE='your note.com cookie string' npx note-mcp
```

For local development:

```bash
npm install
npm run build
node dist/index.js
```

## MCP client configuration

Desktop/local browser-login friendly setup:

```json
{
  "mcpServers": {
    "note": {
      "command": "npx",
      "args": ["-y", "note-mcp"]
    }
  }
}
```

Advanced env-based setup:

```json
{
  "mcpServers": {
    "note": {
      "command": "npx",
      "args": ["-y", "note-mcp"],
      "env": {
        "NOTE_COOKIE": "your note.com cookie string"
      }
    }
  }
}
```

## Authentication

`note-mcp` supports two authentication paths.

### 1. Local/desktop: browser login

For local desktop agents, ask the agent to call:

- `note_auth_login`

Or run it directly:

```bash
npx note-mcp auth
```

This opens a browser, lets you log in to note.com normally, then stores note.com cookies in:

```text
~/.config/note-mcp/config.json
```

If the browser executable is not installed yet, install Playwright's Chromium once on the same machine/user account, then retry:

```bash
npx playwright install chromium
```

When using `note-mcp` only through `npx` and Playwright is not otherwise installed globally/in the project, this form is often more reliable:

```bash
npx -p playwright playwright install chromium
```

For remote servers, containers, or CI, prefer the secret/env/config-file path below instead of browser login.

The config file is written with `0600` permissions where supported.

Useful CLI commands:

```bash
npx note-mcp auth --status
npx note-mcp auth --clear
npx note-mcp auth --headless
npx note-mcp auth --headed
```

### 2. Advanced/server/CI: secret, env, or config file

For remote agents, servers, CI, and secret managers, provide a Cookie header via:

- `NOTE_COOKIE`
- `NOTE_SESSION_COOKIE`
- `NOTE_MCP_CONFIG` pointing to a config JSON file
- MCP tool `note_set_cookie`

Example config file:

```json
{
  "cookie": "your note.com Cookie header",
  "updatedAt": "2026-06-21T00:00:00.000Z"
}
```

Cookie lookup priority:

1. `NOTE_COOKIE`
2. `NOTE_SESSION_COOKIE`
3. config file cookie

## Tools

Authentication/setup tools:

- `note_auth_status` — inspect whether auth is configured
- `note_auth_login` — open a browser login flow and save cookies locally
- `note_set_cookie` — save a Cookie header to the local config file, optionally verifying it first
- `note_clear_cookie` — delete the stored config-file cookie
- `note_login_help` — explain supported setup paths

note.com tools:

- `note_auth_check` — verify configured cookie-based access to note.com internal APIs
- `note_list_my_notes` — list notes for the authenticated account
- `note_list_drafts` — list drafts for the authenticated account
- `note_get_note` — fetch a note by note key, e.g. `n1a0b26f944f4`
- `note_create_draft` — create a draft
- `note_update_draft` — update a draft by draft id

If authentication is missing, note tools return an `auth_required` error suggesting `note_auth_login` or `note_set_cookie`.

## API basis

The initial endpoints are based on public, unofficial note API references, including:

- <https://note.com/ego_station/n/n1a0b26f944f4>

Known endpoint basis:

- Base URL: `https://note.com/api`
- Note detail: `GET /v3/notes/{noteKey}`
- Own contents: `GET /v2/creators/info/contents?kind=note&page=1`
- Draft save: `POST /v1/text_notes/draft_save?id={draftId}`
- Auth smoke test: `GET /v3/notice_counts`

## Release

Releases are handled by GitHub Actions + semantic-release.

- Push or merge Conventional Commits into `main`.
- GitHub Actions runs CI.
- The release workflow creates GitHub tags/releases and publishes to npm.

npm publishing uses npm Trusted Publishing with GitHub Actions OIDC. Configure `new-village/note-mcp` and `.github/workflows/release.yml` as a trusted publisher on npmjs.com. No `NPM_TOKEN` repository secret is required.

## Development

```bash
npm run typecheck
npm test
npm run build
npm run lint
```

## License

MIT
