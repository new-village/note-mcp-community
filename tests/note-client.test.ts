import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readCookieFromEnv } from "../src/note/auth.js";
import { NoteClient } from "../src/note/client.js";
import { NoteApiError } from "../src/note/errors.js";
import type { FetchLike } from "../src/note/types.js";

function response(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function mockFetch(
  handler: FetchLike,
): FetchLike & { calls: Array<[string | URL, RequestInit | undefined]> } {
  const calls: Array<[string | URL, RequestInit | undefined]> = [];
  const fn = async (input: string | URL, init?: RequestInit) => {
    calls.push([input, init]);
    return handler(input, init);
  };
  return Object.assign(fn, { calls });
}

describe("readCookieFromEnv", () => {
  it("reads NOTE_COOKIE first", () => {
    expect(readCookieFromEnv({ NOTE_COOKIE: " a=b " })).toBe("a=b");
  });

  it("throws when no cookie is configured", () => {
    expect(() => readCookieFromEnv({})).toThrow(/Missing note\.com cookie/);
  });
});

describe("NoteClient", () => {
  it("sends cookie and expected headers", async () => {
    const fetchMock = mockFetch(async () => response({ ok: true }));
    const client = new NoteClient({ cookie: "sid=abc", fetch: fetchMock });

    await expect(client.authCheck()).resolves.toEqual({ ok: true });

    expect(fetchMock.calls[0]?.[0]).toBe(
      "https://note.com/api/v3/notice_counts",
    );
    const headers = fetchMock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("cookie")).toBe("sid=abc");
    expect(headers.get("x-requested-with")).toBe("XMLHttpRequest");
  });

  it("returns an LLM-friendly summary when creating drafts with responseFormat summary", async () => {
    const fetchMock = mockFetch(async (input) => {
      if (String(input).endsWith("/v1/text_notes")) {
        return response(
          {
            data: {
              id: 123,
              key: "n123",
              name: "t",
              user: { urlname: "newvillage" },
            },
          },
          { status: 201 },
        );
      }
      return response({ data: { result: true } }, { status: 201 });
    });
    const client = new NoteClient({ cookie: "sid=abc", fetch: fetchMock });

    await expect(
      client.createDraft({
        title: "t",
        body: "<p>b</p>",
        responseFormat: "summary",
      }),
    ).resolves.toEqual({
      id: 123,
      noteId: 123,
      key: "n123",
      noteKey: "n123",
      editUrl: "https://note.com/notes/n123/edit",
      publicUrl: "https://note.com/newvillage/n/n123",
      status: "draft",
      nextActions: {
        uploadEyecatch: { tool: "note_upload_eyecatch", noteId: 123 },
        publish: { tool: "note_publish_draft", noteKey: "n123" },
      },
    });
  });

  it("hydrates create draft summaries from draft detail when the shell response lacks urlname", async () => {
    const fetchMock = mockFetch(async (input) => {
      const url = String(input);
      if (url.endsWith("/v1/text_notes")) {
        return response(
          { data: { id: 123, key: "n123", name: "t" } },
          { status: 201 },
        );
      }
      if (url.includes("/v3/notes/n123?draft=true")) {
        return response({
          data: { id: 123, key: "n123", user: { urlname: "newvillage" } },
        });
      }
      return response({ data: { result: true } }, { status: 201 });
    });
    const client = new NoteClient({ cookie: "sid=abc", fetch: fetchMock });

    await expect(
      client.createDraft({
        title: "t",
        body: "<p>b</p>",
        responseFormat: "summary",
      }),
    ).resolves.toMatchObject({
      publicUrl: "https://note.com/newvillage/n/n123",
    });
    expect(String(fetchMock.calls[2]?.[0])).toMatch(
      /\/v3\/notes\/n123\?draft=true/,
    );
  });

  it("creates drafts by creating a shell note then saving draft content", async () => {
    const fetchMock = mockFetch(async (input) => {
      if (String(input).endsWith("/v1/text_notes")) {
        return response(
          { data: { id: 123, key: "n123", name: "t" } },
          { status: 201 },
        );
      }
      return response({ data: { result: true } }, { status: 201 });
    });
    const client = new NoteClient({ cookie: "sid=abc", fetch: fetchMock });

    await expect(
      client.createDraft({ title: "t", body: "<p>b</p>" }),
    ).resolves.toEqual({
      draft: { id: 123, key: "n123", name: "t" },
      save: { data: { result: true } },
    });

    expect(fetchMock.calls[0]?.[0]).toBe("https://note.com/api/v1/text_notes");
    expect(fetchMock.calls[0]?.[1]?.method).toBe("POST");
    expect(JSON.parse(fetchMock.calls[0]?.[1]?.body as string)).toEqual({
      body: "",
      body_length: 0,
      name: "t",
      index: false,
      is_lead_form: false,
    });
    const createHeaders = fetchMock.calls[0]?.[1]?.headers as Headers;
    expect(createHeaders.get("origin")).toBe("https://editor.note.com");
    expect(createHeaders.get("referer")).toBe("https://editor.note.com/");
    expect(fetchMock.calls[1]?.[0]).toBe(
      "https://note.com/api/v1/text_notes/draft_save?id=123&is_temp_saved=true",
    );
    expect(JSON.parse(fetchMock.calls[1]?.[1]?.body as string)).toEqual({
      body: "<p>b</p>",
      body_length: 1,
      name: "t",
      index: false,
      is_lead_form: false,
    });
    const saveHeaders = fetchMock.calls[1]?.[1]?.headers as Headers;
    expect(saveHeaders.get("origin")).toBe("https://editor.note.com");
    expect(saveHeaders.get("referer")).toBe("https://editor.note.com/");
  });

  it("builds the draft save endpoint for updates", async () => {
    const fetchMock = mockFetch(async () =>
      response({ draft: true }, { status: 201 }),
    );
    const client = new NoteClient({ cookie: "sid=abc", fetch: fetchMock });

    await client.updateDraft({ draftId: "123", title: "t", body: "<p>b</p>" });

    expect(fetchMock.calls[0]?.[0]).toBe(
      "https://note.com/api/v1/text_notes/draft_save?id=123&is_temp_saved=true",
    );
    const init = fetchMock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Headers;
    expect(headers.get("origin")).toBe("https://editor.note.com");
    expect(headers.get("referer")).toBe("https://editor.note.com/");
    expect(JSON.parse(init?.body as string)).toEqual({
      body: "<p>b</p>",
      body_length: 1,
      name: "t",
      index: false,
      is_lead_form: false,
    });
  });

  it("fetches draft details with draft query parameters", async () => {
    const fetchMock = mockFetch(async () =>
      response({ data: { id: 123, key: "n123" } }),
    );
    const client = new NoteClient({ cookie: "sid=abc", fetch: fetchMock });

    await client.getDraft("n123");

    expect(String(fetchMock.calls[0]?.[0])).toMatch(
      /^https:\/\/note\.com\/api\/v3\/notes\/n123\?draft=true&draft_reedit=false&ts=\d+$/,
    );
  });

  it("deletes drafts by numeric note id", async () => {
    const fetchMock = mockFetch(async () =>
      response({ data: { result: true } }),
    );
    const client = new NoteClient({ cookie: "sid=abc", fetch: fetchMock });

    await client.deleteDraft("123");

    expect(fetchMock.calls[0]?.[0]).toBe(
      "https://note.com/api/v1/text_notes/draft_delete?id=123",
    );
    expect(fetchMock.calls[0]?.[1]?.method).toBe("DELETE");
  });

  it("publishes drafts with the current text_notes update payload", async () => {
    const fetchMock = mockFetch(async (input) => {
      if (String(input).includes("/v3/notes/n123?")) {
        return response({
          data: {
            id: 123,
            key: "n123",
            name: "t",
            body: "<p>b</p>",
            price: 0,
            status: "draft",
            slug: "slug-n123",
            sendNotificationsFlag: false,
          },
        });
      }
      return response({ data: { status: "published", key: "n123" } });
    });
    const client = new NoteClient({ cookie: "sid=abc", fetch: fetchMock });

    await expect(client.publishDraft("n123")).resolves.toEqual({
      data: { status: "published", key: "n123" },
    });

    expect(fetchMock.calls[1]?.[0]).toBe(
      "https://note.com/api/v1/text_notes/123",
    );
    expect(fetchMock.calls[1]?.[1]?.method).toBe("PUT");
    const publishHeaders = fetchMock.calls[1]?.[1]?.headers as Headers;
    expect(publishHeaders.get("origin")).toBe("https://editor.note.com");
    expect(publishHeaders.get("referer")).toBe("https://editor.note.com/");
    expect(JSON.parse(fetchMock.calls[1]?.[1]?.body as string)).toMatchObject({
      body_length: 1,
      free_body: "<p>b</p>",
      pay_body: "",
      status: "published",
      name: "t",
      price: 0,
      slug: "slug-n123",
    });
  });

  it("returns an LLM-friendly summary when publishing drafts with responseFormat summary", async () => {
    const fetchMock = mockFetch(async (input) => {
      if (String(input).includes("/v3/notes/n123?")) {
        return response({
          data: {
            id: 123,
            key: "n123",
            name: "t",
            body: "<p>b</p>",
            price: 0,
            status: "draft",
            slug: "slug-n123",
            sendNotificationsFlag: false,
            user: { urlname: "newvillage" },
            eyecatch: "https://assets.example/cover.png",
          },
        });
      }
      return response({
        data: {
          status: "published",
          key: "n123",
          publishAt: "2026-06-21T00:00:00+09:00",
          eyecatch: "https://assets.example/cover.png",
          user: { urlname: "newvillage" },
        },
      });
    });
    const client = new NoteClient({ cookie: "sid=abc", fetch: fetchMock });

    await expect(
      client.publishDraft("n123", { responseFormat: "summary" }),
    ).resolves.toEqual({
      status: "published",
      key: "n123",
      noteKey: "n123",
      noteUrl: "https://note.com/newvillage/n/n123",
      eyecatch: "https://assets.example/cover.png",
      publishedAt: "2026-06-21T00:00:00+09:00",
    });
  });

  it("uploads eyecatch images as multipart form data", async () => {
    const dir = mkdtempSync(join(tmpdir(), "note-mcp-community-"));
    const imagePath = join(dir, "cover.png");
    writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const fetchMock = mockFetch(async () =>
      response({ data: { url: "https://assets.example/cover.png" } }),
    );
    const client = new NoteClient({ cookie: "sid=abc", fetch: fetchMock });

    try {
      await expect(
        client.uploadEyecatch({
          noteId: "166401625",
          imagePath,
          responseFormat: "summary",
        }),
      ).resolves.toEqual({
        noteId: "166401625",
        eyecatchUrl: "https://assets.example/cover.png",
        url: "https://assets.example/cover.png",
        width: 1280,
        height: 670,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(fetchMock.calls[0]?.[0]).toBe(
      "https://note.com/api/v1/image_upload/note_eyecatch",
    );
    const init = fetchMock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Headers;
    expect(headers.get("origin")).toBe("https://editor.note.com");
    expect(headers.get("referer")).toBe("https://editor.note.com/");
    expect(headers.get("content-type")).toBeNull();
    const form = init?.body as FormData;
    expect(form.get("note_id")).toBe("166401625");
    expect(form.get("width")).toBe("1280");
    expect(form.get("height")).toBe("670");
    const file = form.get("file") as File;
    expect(file.name).toBe("cover.png");
    expect(file.type).toBe("image/png");
  });

  it("deletes published notes by note key", async () => {
    const fetchMock = mockFetch(async () =>
      response({ data: { result: true } }),
    );
    const client = new NoteClient({ cookie: "sid=abc", fetch: fetchMock });

    await client.deleteNote("n123");

    expect(fetchMock.calls[0]?.[0]).toBe(
      "https://note.com/api/v1/notes/n/n123",
    );
    expect(fetchMock.calls[0]?.[1]?.method).toBe("DELETE");
  });

  it("returns a summary-only my notes payload when includeBody is false", async () => {
    const fetchMock = mockFetch(async () =>
      response({
        data: {
          contents: [
            {
              key: "nabc123",
              name: "First note",
              body: "<p>long body</p>",
              publishAt: "2026-06-21T00:00:00+09:00",
              status: "published",
              likeCount: 12,
              extra: "large-field",
            },
          ],
          totalCount: 1,
        },
      }),
    );
    const client = new NoteClient({ cookie: "sid=abc", fetch: fetchMock });

    await expect(
      client.listMyNotes(1, { includeBody: false }),
    ).resolves.toEqual({
      data: {
        contents: [
          {
            key: "nabc123",
            title: "First note",
            url: "https://note.com/notes/nabc123",
            publishAt: "2026-06-21T00:00:00+09:00",
            status: "published",
            likeCount: 12,
          },
        ],
        totalCount: 1,
      },
    });
    expect(fetchMock.calls[0]?.[0]).toBe(
      "https://note.com/api/v2/note_list/contents?limit=20&page=1",
    );
  });

  it("summarizes note_list notes arrays from the authenticated user endpoint", async () => {
    const fetchMock = mockFetch(async () =>
      response({
        data: {
          notes: [
            {
              key: "nuser123",
              name: "My own note",
              body: "long body",
              publishAt: "2026-06-21T00:00:00+09:00",
              status: "published",
              likeCount: 3,
              isAuthor: true,
              user: { urlname: "kazu" },
            },
          ],
        },
      }),
    );
    const client = new NoteClient({ cookie: "sid=abc", fetch: fetchMock });

    await expect(client.listMyNotes(1, { fields: "summary" })).resolves.toEqual(
      {
        data: {
          notes: [
            {
              key: "nuser123",
              title: "My own note",
              url: "https://note.com/kazu/n/nuser123",
              publishAt: "2026-06-21T00:00:00+09:00",
              status: "published",
              likeCount: 3,
              isAuthor: true,
            },
          ],
        },
      },
    );
  });

  it("treats fields summary as summary-only my notes output", async () => {
    const fetchMock = mockFetch(async () =>
      response({
        data: {
          contents: [
            {
              noteKey: "ndef456",
              title: "Second note",
              body: "long body",
              publishAt: null,
              status: "draft",
              likeCount: 0,
            },
          ],
        },
      }),
    );
    const client = new NoteClient({ cookie: "sid=abc", fetch: fetchMock });

    await expect(client.listMyNotes(1, { fields: "summary" })).resolves.toEqual(
      {
        data: {
          contents: [
            {
              key: "ndef456",
              title: "Second note",
              publishAt: null,
              status: "draft",
              likeCount: 0,
            },
          ],
        },
      },
    );
  });

  it("lists drafts from the current note_list draft endpoint", async () => {
    const fetchMock = mockFetch(async () =>
      response({
        data: {
          notes: [
            {
              key: "ndraft123",
              name: null,
              status: "draft",
              publishAt: null,
              likeCount: 0,
              isAuthor: true,
              body: "draft body",
            },
          ],
        },
      }),
    );
    const client = new NoteClient({ cookie: "sid=abc", fetch: fetchMock });

    await expect(client.listDrafts(1, { fields: "summary" })).resolves.toEqual({
      data: {
        notes: [
          {
            key: "ndraft123",
            status: "draft",
            publishAt: null,
            likeCount: 0,
            isAuthor: true,
          },
        ],
      },
    });
    expect(fetchMock.calls[0]?.[0]).toBe(
      "https://note.com/api/v2/note_list/contents?limit=20&page=1&status=draft&without_magazines=true",
    );
  });

  it("throws NoteApiError for non-2xx responses", async () => {
    const fetchMock = mockFetch(async () =>
      response({ error: "unauthorized" }, { status: 401 }),
    );
    const client = new NoteClient({ cookie: "bad", fetch: fetchMock });

    await expect(client.authCheck()).rejects.toBeInstanceOf(NoteApiError);
  });
});
