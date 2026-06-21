import { describe, expect, it } from 'vitest';

import { readCookieFromEnv } from '../src/note/auth.js';
import { NoteClient } from '../src/note/client.js';
import { NoteApiError } from '../src/note/errors.js';
import type { FetchLike } from '../src/note/types.js';

function response(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function mockFetch(handler: FetchLike): FetchLike & { calls: Array<[string | URL, RequestInit | undefined]> } {
  const calls: Array<[string | URL, RequestInit | undefined]> = [];
  const fn = async (input: string | URL, init?: RequestInit) => {
    calls.push([input, init]);
    return handler(input, init);
  };
  return Object.assign(fn, { calls });
}

describe('readCookieFromEnv', () => {
  it('reads NOTE_COOKIE first', () => {
    expect(readCookieFromEnv({ NOTE_COOKIE: ' a=b ' })).toBe('a=b');
  });

  it('throws when no cookie is configured', () => {
    expect(() => readCookieFromEnv({})).toThrow(/Missing note\.com cookie/);
  });
});

describe('NoteClient', () => {
  it('sends cookie and expected headers', async () => {
    const fetchMock = mockFetch(async () => response({ ok: true }));
    const client = new NoteClient({ cookie: 'sid=abc', fetch: fetchMock });

    await expect(client.authCheck()).resolves.toEqual({ ok: true });

    expect(fetchMock.calls[0]?.[0]).toBe('https://note.com/api/v3/notice_counts');
    const headers = fetchMock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('cookie')).toBe('sid=abc');
    expect(headers.get('x-requested-with')).toBe('XMLHttpRequest');
  });

  it('builds the draft save endpoint for updates', async () => {
    const fetchMock = mockFetch(async () => response({ draft: true }));
    const client = new NoteClient({ cookie: 'sid=abc', fetch: fetchMock });

    await client.updateDraft({ draftId: '123', title: 't', body: 'b', hashtags: ['mcp'] });

    expect(fetchMock.calls[0]?.[0]).toBe(
      'https://note.com/api/v1/text_notes/draft_save?id=123',
    );
    const init = fetchMock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      title: 't',
      body: 'b',
      hashtags: ['mcp'],
    });
  });

  it('returns a summary-only my notes payload when includeBody is false', async () => {
    const fetchMock = mockFetch(async () =>
      response({
        data: {
          contents: [
            {
              key: 'nabc123',
              name: 'First note',
              body: '<p>long body</p>',
              publishAt: '2026-06-21T00:00:00+09:00',
              status: 'published',
              likeCount: 12,
              extra: 'large-field',
            },
          ],
          totalCount: 1,
        },
      }),
    );
    const client = new NoteClient({ cookie: 'sid=abc', fetch: fetchMock });

    await expect(client.listMyNotes(1, { includeBody: false })).resolves.toEqual({
      data: {
        contents: [
          {
            key: 'nabc123',
            title: 'First note',
            url: 'https://note.com/notes/nabc123',
            publishAt: '2026-06-21T00:00:00+09:00',
            status: 'published',
            likeCount: 12,
          },
        ],
        totalCount: 1,
      },
    });
    expect(fetchMock.calls[0]?.[0]).toBe(
      'https://note.com/api/v2/note_list/contents?limit=20&page=1',
    );
  });

  it('summarizes note_list notes arrays from the authenticated user endpoint', async () => {
    const fetchMock = mockFetch(async () =>
      response({
        data: {
          notes: [
            {
              key: 'nuser123',
              name: 'My own note',
              body: 'long body',
              publishAt: '2026-06-21T00:00:00+09:00',
              status: 'published',
              likeCount: 3,
              isAuthor: true,
              user: { urlname: 'kazu' },
            },
          ],
        },
      }),
    );
    const client = new NoteClient({ cookie: 'sid=abc', fetch: fetchMock });

    await expect(client.listMyNotes(1, { fields: 'summary' })).resolves.toEqual({
      data: {
        notes: [
          {
            key: 'nuser123',
            title: 'My own note',
            url: 'https://note.com/kazu/n/nuser123',
            publishAt: '2026-06-21T00:00:00+09:00',
            status: 'published',
            likeCount: 3,
            isAuthor: true,
          },
        ],
      },
    });
  });

  it('treats fields summary as summary-only my notes output', async () => {
    const fetchMock = mockFetch(async () =>
      response({
        data: {
          contents: [
            {
              noteKey: 'ndef456',
              title: 'Second note',
              body: 'long body',
              publishAt: null,
              status: 'draft',
              likeCount: 0,
            },
          ],
        },
      }),
    );
    const client = new NoteClient({ cookie: 'sid=abc', fetch: fetchMock });

    await expect(client.listMyNotes(1, { fields: 'summary' })).resolves.toEqual({
      data: {
        contents: [
          {
            key: 'ndef456',
            title: 'Second note',
            publishAt: null,
            status: 'draft',
            likeCount: 0,
          },
        ],
      },
    });
  });

  it('lists drafts from the current note_list draft endpoint', async () => {
    const fetchMock = mockFetch(async () =>
      response({
        data: {
          notes: [
            {
              key: 'ndraft123',
              name: null,
              status: 'draft',
              publishAt: null,
              likeCount: 0,
              isAuthor: true,
              body: 'draft body',
            },
          ],
        },
      }),
    );
    const client = new NoteClient({ cookie: 'sid=abc', fetch: fetchMock });

    await expect(client.listDrafts(1, { fields: 'summary' })).resolves.toEqual({
      data: {
        notes: [
          {
            key: 'ndraft123',
            status: 'draft',
            publishAt: null,
            likeCount: 0,
            isAuthor: true,
          },
        ],
      },
    });
    expect(fetchMock.calls[0]?.[0]).toBe(
      'https://note.com/api/v2/note_list/contents?limit=20&page=1&status=draft&without_magazines=true',
    );
  });

  it('throws NoteApiError for non-2xx responses', async () => {
    const fetchMock = mockFetch(async () => response({ error: 'unauthorized' }, { status: 401 }));
    const client = new NoteClient({ cookie: 'bad', fetch: fetchMock });

    await expect(client.authCheck()).rejects.toBeInstanceOf(NoteApiError);
  });
});
