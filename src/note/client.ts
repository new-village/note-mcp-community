import { NoteApiError } from './errors.js';
import type {
  DraftPayload,
  FetchLike,
  JsonValue,
  ListMyNotesOptions,
  NoteClientOptions,
} from './types.js';

const BASE_URL = 'https://note.com/api';
const EDITOR_ORIGIN = 'https://editor.note.com';
const EDITOR_REFERER = 'https://editor.note.com/';
const DEFAULT_USER_AGENT =
  'note-mcp/0.0.0 (+https://github.com/new-village/note-mcp)';

export class NoteClient {
  private readonly cookie: string;
  private readonly userAgent: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: NoteClientOptions) {
    this.cookie = options.cookie;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async authCheck(): Promise<JsonValue> {
    return this.request('/v3/notice_counts');
  }

  async listMyNotes(page = 1, options: ListMyNotesOptions = {}): Promise<JsonValue> {
    const limit = options.limit ?? 20;
    const payload = await this.request(`/v2/note_list/contents?limit=${limit}&page=${page}`);
    if (options.fields === 'summary' || options.includeBody === false) {
      return summarizeListPayload(payload);
    }
    return payload;
  }

  async listDrafts(page = 1, options: ListMyNotesOptions = {}): Promise<JsonValue> {
    const limit = options.limit ?? 20;
    const payload = await this.request(
      `/v2/note_list/contents?limit=${limit}&page=${page}&status=draft&without_magazines=true`,
    );
    if (options.fields === 'summary' || options.includeBody === false) {
      return summarizeListPayload(payload);
    }
    return payload;
  }

  async getNote(noteKey: string): Promise<JsonValue> {
    return this.request(`/v3/notes/${encodeURIComponent(noteKey)}`);
  }

  async getDraft(noteKey: string): Promise<JsonValue> {
    return this.request(
      `/v3/notes/${encodeURIComponent(noteKey)}?draft=true&draft_reedit=false&ts=${Date.now()}`,
    );
  }

  async createDraft(payload: Omit<DraftPayload, 'draftId'>): Promise<JsonValue> {
    const shell = await this.request('/v1/text_notes', {
      method: 'POST',
      body: JSON.stringify({
        body: '',
        body_length: 0,
        name: payload.title,
        index: false,
        is_lead_form: false,
      }),
    });
    const draft = extractDraft(shell);
    const save = await this.saveDraft({ ...payload, draftId: String(draft.id) });
    return { draft, save };
  }

  async updateDraft(payload: DraftPayload & { draftId: string }): Promise<JsonValue> {
    return this.saveDraft(payload);
  }

  async publishDraft(noteKey: string): Promise<JsonValue> {
    const draft = await this.getDraft(noteKey);
    const note = extractNoteData(draft);
    return this.request(`/v1/text_notes/${encodeURIComponent(String(note.id))}`, {
      method: 'PUT',
      body: JSON.stringify(publishPayload(note)),
    });
  }

  async deleteDraft(draftId: string): Promise<JsonValue> {
    return this.request(`/v1/text_notes/draft_delete?id=${encodeURIComponent(draftId)}`, {
      method: 'DELETE',
    });
  }

  async deleteNote(noteKey: string): Promise<JsonValue> {
    return this.request(`/v1/notes/n/${encodeURIComponent(noteKey)}`, {
      method: 'DELETE',
    });
  }

  private async saveDraft(payload: DraftPayload & { draftId: string }): Promise<JsonValue> {
    return this.request(
      `/v1/text_notes/draft_save?id=${encodeURIComponent(payload.draftId)}&is_temp_saved=true`,
      {
        method: 'POST',
        body: JSON.stringify({
          body: payload.body,
          body_length: payload.bodyLength ?? textLength(payload.body),
          name: payload.title,
          index: false,
          is_lead_form: false,
        }),
      },
    );
  }

  private async request(path: string, init: RequestInit = {}): Promise<JsonValue> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    headers.set('cookie', this.cookie);
    headers.set('user-agent', this.userAgent);
    headers.set('x-requested-with', 'XMLHttpRequest');

    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    const method = init.method?.toUpperCase();
    if (method === 'POST' || method === 'PUT') {
      headers.set('origin', EDITOR_ORIGIN);
      headers.set('referer', EDITOR_REFERER);
    }

    const response = await this.fetchImpl(`${BASE_URL}${path}`, {
      ...init,
      headers,
    });

    const body = await parseBody(response);
    if (!response.ok) {
      throw new NoteApiError(
        `note.com API request failed: ${response.status} ${response.statusText}`,
        response.status,
        body,
      );
    }

    return body;
  }
}

function extractDraft(payload: JsonValue): { [key: string]: JsonValue; id: string | number } {
  if (isJsonObject(payload) && isJsonObject(payload.data)) {
    const id = payload.data.id;
    if (typeof id === 'number' || typeof id === 'string') {
      return { ...payload.data, id };
    }
  }
  throw new NoteApiError('note.com draft shell response did not include data.id', 502, payload);
}

function extractNoteData(payload: JsonValue): { [key: string]: JsonValue; id: string | number } {
  if (isJsonObject(payload) && isJsonObject(payload.data)) {
    const id = payload.data.id;
    if (typeof id === 'number' || typeof id === 'string') {
      return { ...payload.data, id };
    }
  }
  throw new NoteApiError('note.com note response did not include data.id', 502, payload);
}

function publishPayload(note: { [key: string]: JsonValue; id: string | number }): { [key: string]: JsonValue } {
  const body = firstString(note.body) ?? '';
  return {
    author_ids: [],
    body_length: textLength(body),
    disable_comment: Boolean(note.disableComment ?? note.disable_comment ?? false),
    exclude_from_creator_top: Boolean(note.excludeFromCreatorTop ?? note.exclude_from_creator_top ?? false),
    exclude_ai_learning_reward: Boolean(
      note.excludeAiLearningReward ?? note.exclude_ai_learning_reward ?? false,
    ),
    translation_setting: note.translationSetting ?? note.translation_setting ?? null,
    free_body: body,
    hashtags: [],
    image_keys: [],
    index: false,
    is_refund: false,
    limited: false,
    magazine_ids: [],
    magazine_keys: [],
    name: firstString(note.name) ?? '',
    pay_body: '',
    price: typeof note.price === 'number' ? note.price : 0,
    send_notifications_flag: Boolean(note.sendNotificationsFlag ?? note.send_notifications_flag ?? false),
    separator: note.separator ?? null,
    slug: note.slug ?? null,
    status: 'published',
    stock_photo_image_id: note.stockPhotoImageId ?? note.stock_photo_image_id ?? null,
    owner_urlname: null,
    circle_permissions: null,
    discount_campaigns: [],
    lead_form: null,
    line_add_friend: null,
    line_add_friend_access_token: null,
    pro_coupon_keys: [],
  };
}

function textLength(html: string): number {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim().length;
}

function summarizeListPayload(payload: JsonValue): JsonValue {
  if (!isJsonObject(payload)) return payload;

  if (isJsonObject(payload.data) && Array.isArray(payload.data.contents)) {
    return {
      ...payload,
      data: {
        ...payload.data,
        contents: payload.data.contents.map(summarizeNoteItem),
      },
    };
  }

  if (isJsonObject(payload.data) && Array.isArray(payload.data.notes)) {
    return {
      ...payload,
      data: {
        ...payload.data,
        notes: payload.data.notes.map(summarizeNoteItem),
      },
    };
  }

  if (Array.isArray(payload.contents)) {
    return {
      ...payload,
      contents: payload.contents.map(summarizeNoteItem),
    };
  }

  return payload;
}

function summarizeNoteItem(item: JsonValue): JsonValue {
  if (!isJsonObject(item)) return item;

  const key = firstString(item.key, item.noteKey, item.id);
  return omitUndefined({
    key,
    title: firstString(item.title, item.name),
    url:
      firstString(item.url, item.noteUrl, item.note_url, item.path) ?? noteUrl(key, item.user, item.status),
    publishAt: firstDefined(item.publishAt, item.publish_at, item.publishedAt, item.published_at),
    status: item.status,
    likeCount: firstDefined(item.likeCount, item.like_count),
    isAuthor: item.isAuthor,
  });
}

function firstDefined(...values: Array<JsonValue | undefined>): JsonValue | undefined {
  return values.find((value) => value !== undefined);
}

function firstString(...values: Array<JsonValue | undefined>): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function noteUrl(
  key: string | undefined,
  user: JsonValue | undefined,
  status: JsonValue | undefined,
): string | undefined {
  if (!key || status === 'draft') return undefined;
  if (isJsonObject(user)) {
    const urlname = firstString(user.urlname);
    if (urlname) return `https://note.com/${urlname}/n/${key}`;
  }
  return `https://note.com/notes/${key}`;
}

function omitUndefined(record: Record<string, JsonValue | undefined>): { [key: string]: JsonValue } {
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined),
  );
}

function isJsonObject(value: unknown): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function parseBody(response: Response): Promise<JsonValue> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return text;
  }
}
