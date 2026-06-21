# note-mcp

Unofficial stdio MCP server for note.com. It uses cookie-based access to note.com's internal APIs.

> [!WARNING]
> This project is unofficial and not affiliated with note.com. Internal APIs can change without notice. Keep cookies local and never commit them to GitHub, npm, logs, or issue reports.

## Quick start

### Local/desktop agents

Use browser login first:

```bash
npx note-mcp auth
```

After you log in to note.com in the opened browser, `note-mcp` saves the cookie locally and prints the saved file path:

```json
{
  "authenticated": true,
  "saved": true,
  "configPath": "/Users/you/.config/note-mcp/config.json",
  "cookiePreview": "fp=b…5948",
  "message": "note.com authentication configured from browser login. Cookie saved to /Users/you/.config/note-mcp/config.json."
}
```

Then configure your MCP client without putting cookies in the config:

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

Some MCP clients only load newly added tools when a process or conversation starts. After authentication or config changes, restart the client or open a new thread/session if `note_*` tools do not appear immediately.

Quick setup check:

1. `npx note-mcp auth`
2. `npx note-mcp auth --status`
3. Add `npx -y note-mcp` to your MCP client config
4. Restart the client or open a new thread/session
5. Run `note_auth_status` from the MCP client

### Servers, containers, and CI

Do not rely on browser login in headless/container environments. Provide a cookie through env or a mounted config file instead:

```bash
NOTE_COOKIE='your note.com Cookie header' npx note-mcp
```

Or mount a config file and point `NOTE_MCP_CONFIG` at it:

```bash
docker run \
  -v ~/.config/note-mcp/config.json:/run/secrets/note-mcp-config.json:ro \
  -e NOTE_MCP_CONFIG=/run/secrets/note-mcp-config.json \
  your-agent-image
```

## Install / run

```bash
npx note-mcp
```

For local development:

```bash
npm install
npm run build
node dist/index.js
```

## MCP client configuration

Recommended desktop setup after `npx note-mcp auth`:

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
        "NOTE_COOKIE": "your note.com Cookie header"
      }
    }
  }
}
```

### Codex CLI

For Codex, add `note-mcp` as a stdio MCP server with `npx`:

```bash
codex mcp add note -- npx -y note-mcp
codex mcp list
npx -y note-mcp auth --status
```

Recommended verification flow:

1. `npx note-mcp auth`
2. `npx note-mcp auth --status`
3. `codex mcp add note -- npx -y note-mcp`
4. Restart Codex or create a new thread
5. Run `note_auth_status`

If the server is listed but `note_*` tools are not available in the current thread, restart Codex or start a new thread so the MCP tools are loaded from the new configuration.

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

The CLI and MCP tool response include the actual `configPath` used.

If the browser executable is not installed yet, install Playwright's Chromium once on the same machine/user account, then retry:

```bash
npx playwright install chromium
```

When using `note-mcp` only through `npx` and Playwright is not otherwise installed globally/in the project, this form is often more reliable:

```bash
npx -p playwright playwright install chromium
```

For remote servers, containers, or CI, prefer the secret/env/config-file path below instead of browser login.

Useful CLI commands:

```bash
npx note-mcp auth --status
npx note-mcp auth --clear
npx note-mcp auth --headless
npx note-mcp auth --headed
```

### 2. Advanced/server/CI: secret, env, or config file

For remote agents, servers, containers, CI, and secret managers, provide a Cookie header via:

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

Default config path:

```text
~/.config/note-mcp/config.json
```

Override config path:

```bash
NOTE_MCP_CONFIG=/path/to/config.json npx note-mcp
```

## Tools

Authentication/setup tools:

- `note_auth_status` — inspect whether auth is configured and which config path is used
- `note_auth_login` — open a browser login flow and save cookies locally; response includes `configPath`
- `note_set_cookie` — save a Cookie header to the local config file, optionally verifying it first
- `note_clear_cookie` — delete the stored config-file cookie
- `note_login_help` — explain supported setup paths

note.com tools:

- `note_auth_check` — verify configured cookie-based access to note.com internal APIs
- `note_list_my_notes` — list notes for the authenticated account via `GET /v2/note_list/contents?limit={limit}&page={page}`. By default returns the full internal API payload. For LLM-friendly list views, pass `fields: "summary"` or `includeBody: false` to return summary fields such as `title`, `key`, `url`, `publishAt`, `status`, `likeCount`, and `isAuthor`.
- `note_list_drafts` — list drafts for the authenticated account via `GET /v2/note_list/contents?limit={limit}&page={page}&status=draft&without_magazines=true`. By default returns the full internal API payload. For LLM-friendly list views, pass `fields: "summary"` or `includeBody: false`.
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
- Authenticated note list: `GET /v2/note_list/contents?limit=20&page=1`
- Authenticated draft list: `GET /v2/note_list/contents?limit=20&page=1&status=draft&without_magazines=true`
- Draft save: `POST /v1/text_notes/draft_save?id={draftId}`
- Auth smoke test: `GET /v3/notice_counts`

`note_list_my_notes` and `note_list_drafts` intentionally expose the authenticated note list endpoints above. The response shape is determined by note.com's internal API and typically returns items under `data.notes`; use the default full response when debugging endpoint behavior, and use summary mode when a compact list is enough. Summary mode does not invent public URLs for drafts unless note.com returns an explicit URL/path.

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
