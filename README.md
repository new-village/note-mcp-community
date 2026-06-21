# note-mcp-community

Unofficial, community-maintained stdio MCP server for note.com. It uses cookie-based access to note.com's internal APIs.

> [!WARNING]
> This project is unofficial and not affiliated with note.com. Internal APIs can change without notice. Keep cookies local and never commit them to GitHub, npm, logs, or issue reports.

## Quick start

### Local/desktop agents

Use browser login first:

```bash
npx note-mcp-community auth
```

After you log in to note.com in the opened browser, `note-mcp-community` saves the cookie locally and prints the saved file path:

```json
{
  "authenticated": true,
  "saved": true,
  "configPath": "/Users/you/.config/note-mcp-community/config.json",
  "cookiePreview": "fp=b…5948",
  "message": "note.com authentication configured from browser login. Cookie saved to /Users/you/.config/note-mcp-community/config.json."
}
```

Then configure your MCP client without putting cookies in the config:

```json
{
  "mcpServers": {
    "note": {
      "command": "npx",
      "args": ["-y", "note-mcp-community"]
    }
  }
}
```

Some MCP clients only load newly added tools when a process or conversation starts. After authentication or config changes, restart the client or open a new thread/session if `note_*` tools do not appear immediately.

Quick setup check:

1. `npx note-mcp-community auth`
2. `npx note-mcp-community auth --status`
3. Add `npx -y note-mcp-community` to your MCP client config
4. Restart the client or open a new thread/session
5. Run `note_auth_status` from the MCP client

### Servers, containers, and CI

Do not rely on browser login in headless/container environments. Provide a cookie through env or a mounted config file instead:

```bash
NOTE_COOKIE='your note.com Cookie header' npx note-mcp-community
```

Or mount a config file and point `NOTE_MCP_COMMUNITY_CONFIG` at it:

```bash
docker run \
  -v ~/.config/note-mcp-community/config.json:/run/secrets/note-mcp-community-config.json:ro \
  -e NOTE_MCP_COMMUNITY_CONFIG=/run/secrets/note-mcp-community-config.json \
  your-agent-image
```

## Install / run

```bash
npx note-mcp-community
```

For local development:

```bash
npm install
npm run build
node dist/index.js
```

## MCP client configuration

Recommended desktop setup after `npx note-mcp-community auth`:

```json
{
  "mcpServers": {
    "note": {
      "command": "npx",
      "args": ["-y", "note-mcp-community"]
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
      "args": ["-y", "note-mcp-community"],
      "env": {
        "NOTE_COOKIE": "your note.com Cookie header"
      }
    }
  }
}
```

### Codex CLI

For Codex, add `note-mcp-community` as a stdio MCP server with `npx`:

```bash
codex mcp add note -- npx -y note-mcp-community
codex mcp list
npx -y note-mcp-community auth --status
```

Recommended verification flow:

1. `npx note-mcp-community auth`
2. `npx note-mcp-community auth --status`
3. `codex mcp add note -- npx -y note-mcp-community`
4. Restart Codex or create a new thread
5. Run `note_auth_status`

If the server is listed but `note_*` tools are not available in the current thread, restart Codex or start a new thread so the MCP tools are loaded from the new configuration.

## Authentication

`note-mcp-community` supports two authentication paths.

### 1. Local/desktop: browser login

For local desktop agents, ask the agent to call:

- `note_auth_login`

Or run it directly:

```bash
npx note-mcp-community auth
```

This opens a browser, lets you log in to note.com normally, then stores note.com cookies in:

```text
~/.config/note-mcp-community/config.json
```

The CLI and MCP tool response include the actual `configPath` used.

If the browser executable is not installed yet, install Playwright's Chromium once on the same machine/user account, then retry:

```bash
npx playwright install chromium
```

When using `note-mcp-community` only through `npx` and Playwright is not otherwise installed globally/in the project, this form is often more reliable:

```bash
npx -p playwright playwright install chromium
```

For remote servers, containers, or CI, prefer the secret/env/config-file path below instead of browser login.

Useful CLI commands:

```bash
npx note-mcp-community auth --status
npx note-mcp-community auth --clear
npx note-mcp-community auth --headless
npx note-mcp-community auth --headed
```

### 2. Advanced/server/CI: secret, env, or config file

For remote agents, servers, containers, CI, and secret managers, provide a Cookie header via:

- `NOTE_COOKIE`
- `NOTE_SESSION_COOKIE`
- `NOTE_MCP_COMMUNITY_CONFIG` pointing to a config JSON file
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
~/.config/note-mcp-community/config.json
```

Override config path:

```bash
NOTE_MCP_COMMUNITY_CONFIG=/path/to/config.json npx note-mcp-community
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
- `note_get_draft` — fetch authenticated draft detail by note key via `GET /v3/notes/{noteKey}?draft=true&draft_reedit=false`
- `note_create_draft` — create a draft by first calling `POST /v1/text_notes` with an empty-body editor payload to obtain `data.id`/`data.key`, then saving content via `draft_save`. By default returns an LLM-friendly summary with `id`/`noteId`, `key`/`noteKey`, `editUrl`, `publicUrl`, and `nextActions`; pass `responseFormat: "full"` for raw responses.
- `note_update_draft` — update a draft by numeric draft/note id. By default returns a compact summary; pass `responseFormat: "full"` for raw responses.
- `note_publish_draft` — publicly publish a draft by note key; internally resolves the numeric id from draft detail, then calls `PUT /v1/text_notes/{id}` with note.com's current publish payload. By default returns `status`, `key`, `noteUrl`, `eyecatch`, and `publishedAt`; pass `responseFormat: "full"` for raw responses.
- `note_upload_eyecatch` — upload an eyecatch/cover image via `POST /v1/image_upload/note_eyecatch`. Use the `draft.id` returned by `note_create_draft` as `noteId`; this can be called before publishing. Provide numeric `noteId` and either `imagePath` or `imageUrl`; width/height default to note.com's recommended `1280x670`. By default returns `noteId` and `eyecatchUrl`; pass `responseFormat: "full"` for raw responses.
- `note_delete_draft` — delete an unpublished draft by numeric draft/note id via `DELETE /v1/text_notes/draft_delete?id={draftId}`
- `note_delete_note` — delete a published/deletable note by note key via `DELETE /v1/notes/n/{noteKey}`

If authentication is missing, note tools return an `auth_required` error suggesting `note_auth_login` or `note_set_cookie`.

### Body format for AI agents

`note_create_draft` and `note_update_draft` send `body` directly to note.com's internal editor API. note.com does not automatically render Markdown in this field.

If you want headings, lists, links, or emphasis to appear formatted, pass note-compatible HTML:

```html
<h2>テスト内容</h2>
<ul>
  <li>下書き作成</li>
  <li>公開</li>
</ul>
```

Do not pass Markdown if visual formatting is expected:

```markdown
## テスト内容

- 下書き作成
- 公開
```

AI agents should generate or convert content to note-compatible HTML before calling the tool. `note-mcp-community` intentionally stays a thin bridge to note.com's API; Markdown-to-HTML conversion belongs in the caller or a future optional helper, not in the core draft tools.

Recommended body HTML:

- `<h2>`, `<h3>` for headings
- `<p>` for paragraphs
- `<ul><li>` / `<ol><li>` for lists
- `<strong>`, `<em>` for emphasis
- `<a href="...">` for links

Avoid:

- Full HTML documents (`<html>`, `<head>`, `<body>`)
- Inline scripts/styles
- Unsupported custom attributes

## API basis

The initial endpoints are based on public, unofficial note API references, including:

- <https://note.com/ego_station/n/n1a0b26f944f4>

Known endpoint basis:

- Base URL: `https://note.com/api`
- Note detail: `GET /v3/notes/{noteKey}`
- Draft detail: `GET /v3/notes/{noteKey}?draft=true&draft_reedit=false&ts={timestamp}`
- Authenticated note list: `GET /v2/note_list/contents?limit=20&page=1`
- Authenticated draft list: `GET /v2/note_list/contents?limit=20&page=1&status=draft&without_magazines=true`
- Draft shell create/id lookup: `POST /v1/text_notes` with `{ "body": "", "body_length": 0, "name": "...", "index": false, "is_lead_form": false }`; response includes numeric `data.id` and note `data.key`. Mutating editor requests should include `Origin: https://editor.note.com`, `Referer: https://editor.note.com/`, `X-Requested-With: XMLHttpRequest`, and `Content-Type: application/json`.
- Draft save/update: `POST /v1/text_notes/draft_save?id={draftId}&is_temp_saved=true` with `body`, `body_length`, `name`, `index`, and `is_lead_form`
- Draft publish: `PUT /v1/text_notes/{draftId}` with `free_body`, `pay_body`, `body_length`, and `status: "published"`
- Eyecatch upload: `POST /v1/image_upload/note_eyecatch` as multipart/form-data with `note_id`, binary `file`, `width`, and `height`. The default/recommended image dimensions are `1280x670`.
- Draft delete: `DELETE /v1/text_notes/draft_delete?id={draftId}`
- Published/deletable note delete: `DELETE /v1/notes/n/{noteKey}`
- Auth smoke test: `GET /v3/notice_counts`

`note_list_my_notes` and `note_list_drafts` intentionally expose the authenticated note list endpoints above. The response shape is determined by note.com's internal API and typically returns items under `data.notes`; use the default full response when debugging endpoint behavior, and use summary mode when a compact list is enough. Summary mode does not invent public URLs for drafts unless note.com returns an explicit URL/path.

## Release

Releases are handled by GitHub Actions + semantic-release.

- Push or merge Conventional Commits into `main`.
- GitHub Actions runs CI.
- The release workflow creates GitHub tags/releases and publishes to npm.

npm publishing uses npm Trusted Publishing with GitHub Actions OIDC. Configure `new-village/note-mcp-community` and `.github/workflows/release.yml` as a trusted publisher on npmjs.com. No `NPM_TOKEN` repository secret is required.

## Development

```bash
npm run typecheck
npm test
npm run build
npm run lint
```

## License

MIT
