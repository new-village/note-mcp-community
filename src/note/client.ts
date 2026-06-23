import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

import sharp from "sharp";

import { NoteApiError } from "./errors.js";
import type {
  BundleDraftPayload,
  DraftPayload,
  FetchLike,
  GetNoteOptions,
  JsonValue,
  ListMyNotesOptions,
  NoteClientOptions,
  PublishDraftOptions,
  UploadEyecatchPayload,
  UpdateDraftBundlePayload,
} from "./types.js";

const BASE_URL = "https://note.com/api";
const EDITOR_ORIGIN = "https://editor.note.com";
const EDITOR_REFERER = "https://editor.note.com/";
const DEFAULT_USER_AGENT =
  "note-mcp-community/0.0.0 (+https://github.com/new-village/note-mcp-community)";
const NOTE_EYECATCH_WIDTH = 1280;
const NOTE_EYECATCH_HEIGHT = 670;
const MAX_EYECATCH_BYTES = 10 * 1024 * 1024;

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
    return this.request("/v3/notice_counts");
  }

  async listMyNotes(
    page = 1,
    options: ListMyNotesOptions = {},
  ): Promise<JsonValue> {
    const limit = options.limit ?? 20;
    const payload = await this.request(
      `/v2/note_list/contents?limit=${limit}&page=${page}`,
    );
    if (options.fields !== "full" || options.includeBody === false) {
      return summarizeListPayload(payload);
    }
    return payload;
  }

  async listDrafts(
    page = 1,
    options: ListMyNotesOptions = {},
  ): Promise<JsonValue> {
    const limit = options.limit ?? 20;
    const payload = await this.request(
      `/v2/note_list/contents?limit=${limit}&page=${page}&status=draft&without_magazines=true`,
    );
    if (options.fields !== "full" || options.includeBody === false) {
      return summarizeListPayload(payload);
    }
    return payload;
  }

  async getNote(
    noteKey: string,
    options: GetNoteOptions = {},
  ): Promise<JsonValue> {
    const query = options.draft
      ? `?draft=true&draft_reedit=false&ts=${Date.now()}`
      : "";
    const payload = await this.request(
      `/v3/notes/${encodeURIComponent(noteKey)}${query}`,
    );
    if (
      options.responseFormat !== "full" ||
      options.fields ||
      options.includeBody === false
    ) {
      return summarizeNotePayload(payload, options);
    }
    return payload;
  }

  async getDraft(noteKey: string): Promise<JsonValue> {
    return this.getNote(noteKey, { draft: true, responseFormat: "full" });
  }

  async createDraft(
    payload: Omit<DraftPayload, "draftId">,
  ): Promise<JsonValue> {
    const shell = await this.request("/v1/text_notes", {
      method: "POST",
      body: JSON.stringify({
        body: "",
        body_length: 0,
        name: payload.title,
        index: false,
        is_lead_form: false,
      }),
    });
    const draft = extractDraft(shell);
    const save = await this.saveDraft({
      ...payload,
      draftId: String(draft.id),
      responseFormat: "full",
    });
    if (payload.responseFormat === "summary") {
      return this.hydratedDraftSummary(draft);
    }
    return { draft, save };
  }

  async updateDraft(
    payload: DraftPayload & { draftId: string },
  ): Promise<JsonValue> {
    const save = await this.saveDraft(payload);
    if (payload.responseFormat === "summary") {
      return omitUndefined({
        id: payload.draftId,
        noteId: payload.draftId,
        status: "draft",
        updated: true,
      });
    }
    return save;
  }

  async updateDraftByNoteKey(
    payload: DraftPayload & { noteKey: string },
  ): Promise<JsonValue> {
    const draft = await this.getDraft(payload.noteKey);
    const note = extractNoteData(draft);
    const result = await this.updateDraft({
      ...payload,
      draftId: String(note.id),
    });
    if (payload.responseFormat === "summary") {
      const key = firstString(note.key, note.noteKey, payload.noteKey);
      return omitUndefined({
        ...(isJsonObject(result) ? result : {}),
        id: String(note.id),
        noteId: String(note.id),
        key,
        noteKey: key,
        noteUrl: noteUrl(key, note.user, note.status),
      });
    }
    return result;
  }

  async prepareDraftBundle(payload: BundleDraftPayload): Promise<JsonValue> {
    const draft = await this.createDraft({
      title: payload.title,
      body: payload.bodyHtml,
      ...(payload.hashtags ? { hashtags: payload.hashtags } : {}),
      responseFormat: "summary",
    });
    const source = isJsonObject(draft) ? draft : {};
    const noteId = firstDefined(source.noteId, source.id);
    const noteKey = firstString(source.noteKey, source.key);
    const eyecatch = await this.maybeUploadBundleEyecatch({
      ...(noteId === undefined ? {} : { noteId: String(noteId) }),
      ...(noteKey ? { noteKey } : {}),
      ...(payload.eyecatchImagePath
        ? { imagePath: payload.eyecatchImagePath }
        : {}),
      ...(payload.eyecatchImageUrl
        ? { imageUrl: payload.eyecatchImageUrl }
        : {}),
      ...(payload.verify === undefined ? {} : { verify: payload.verify }),
    });
    return bundleSummary(source, eyecatch);
  }

  async updateDraftBundle(
    payload: UpdateDraftBundlePayload,
  ): Promise<JsonValue> {
    const updated = await this.updateDraftByNoteKey({
      noteKey: payload.noteKey,
      title: payload.title,
      body: payload.bodyHtml,
      ...(payload.hashtags ? { hashtags: payload.hashtags } : {}),
      responseFormat: "summary",
    });
    const source = isJsonObject(updated) ? updated : {};
    const noteId = firstDefined(source.noteId, source.id);
    const eyecatch = await this.maybeUploadBundleEyecatch({
      ...(noteId === undefined ? {} : { noteId: String(noteId) }),
      noteKey: payload.noteKey,
      ...(payload.eyecatchImagePath
        ? { imagePath: payload.eyecatchImagePath }
        : {}),
      ...(payload.eyecatchImageUrl
        ? { imageUrl: payload.eyecatchImageUrl }
        : {}),
      ...(payload.verify === undefined ? {} : { verify: payload.verify }),
    });
    return bundleSummary(source, eyecatch);
  }

  async publishDraft(
    noteKey: string,
    options: PublishDraftOptions = {},
  ): Promise<JsonValue> {
    const draft = await this.getDraft(noteKey);
    const note = extractNoteData(draft);
    const published = await this.request(
      `/v1/text_notes/${encodeURIComponent(String(note.id))}`,
      {
        method: "PUT",
        body: JSON.stringify(publishPayload(note)),
      },
    );
    if (options.responseFormat === "summary") {
      return publishSummary(published, note);
    }
    return published;
  }

  async uploadEyecatch(payload: UploadEyecatchPayload): Promise<JsonValue> {
    const noteId =
      payload.noteId ??
      (payload.noteKey ? await this.resolveNoteId(payload.noteKey) : undefined);
    if (!noteId) {
      throw new NoteApiError("noteId or noteKey is required", 400, null);
    }
    const resolvedNoteId = noteId;

    const file = await this.fileFromPayload(payload);
    const form = new FormData();
    form.append("note_id", resolvedNoteId);
    form.append("file", file);
    form.append("width", String(payload.width ?? NOTE_EYECATCH_WIDTH));
    form.append("height", String(payload.height ?? NOTE_EYECATCH_HEIGHT));

    const uploaded = await this.request("/v1/image_upload/note_eyecatch", {
      method: "POST",
      body: form,
    });
    if (payload.responseFormat === "summary") {
      const summary = eyecatchSummary(uploaded, { ...payload, noteId });
      if (payload.verify && payload.noteKey) {
        return Object.assign({}, isJsonObject(summary) ? summary : {}, {
          verification: summarizeNotePayload(
            await this.getDraft(payload.noteKey),
            {
              responseFormat: "summary",
            },
          ),
        });
      }
      return summary;
    }
    return uploaded;
  }

  async deleteDraft(draftId: string): Promise<JsonValue> {
    return this.request(
      `/v1/text_notes/draft_delete?id=${encodeURIComponent(draftId)}`,
      {
        method: "DELETE",
      },
    );
  }

  async deleteNote(noteKey: string): Promise<JsonValue> {
    return this.request(`/v1/notes/n/${encodeURIComponent(noteKey)}`, {
      method: "DELETE",
    });
  }

  private async resolveNoteId(noteKey: string): Promise<string> {
    const draft = await this.getDraft(noteKey);
    return String(extractNoteData(draft).id);
  }

  private async maybeUploadBundleEyecatch(payload: {
    noteId?: string;
    noteKey?: string;
    imagePath?: string;
    imageUrl?: string;
    verify?: boolean;
  }): Promise<JsonValue | undefined> {
    if (!payload.imagePath && !payload.imageUrl) return undefined;
    return this.uploadEyecatch({
      ...payload,
      targetSize: "note-eyecatch",
      fit: "center-crop",
      responseFormat: "summary",
    });
  }

  private async hydratedDraftSummary(draft: {
    [key: string]: JsonValue;
    id: string | number;
  }): Promise<JsonValue> {
    const key = firstString(draft.key, draft.noteKey);
    if (!key || urlnameFromUser(draft.user) || firstString(draft.urlname)) {
      return draftSummary(draft);
    }

    try {
      const detail = await this.getDraft(key);
      if (isJsonObject(detail) && isJsonObject(detail.data)) {
        return draftSummary({ ...draft, ...detail.data, id: draft.id });
      }
    } catch {
      // Keep draft creation successful even if optional summary hydration fails.
    }
    return draftSummary(draft);
  }

  private async saveDraft(
    payload: DraftPayload & { draftId: string },
  ): Promise<JsonValue> {
    return this.request(
      `/v1/text_notes/draft_save?id=${encodeURIComponent(payload.draftId)}&is_temp_saved=true`,
      {
        method: "POST",
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

  private async fileFromPayload(payload: UploadEyecatchPayload): Promise<File> {
    if (payload.imagePath) {
      const info = await stat(payload.imagePath);
      if (info.size > MAX_EYECATCH_BYTES) {
        throw new NoteApiError(
          "eyecatch image exceeds note.com's 10MB limit",
          400,
          {
            imagePath: payload.imagePath,
            size: info.size,
            maxSize: MAX_EYECATCH_BYTES,
          },
        );
      }
      const bytes = await readFile(payload.imagePath);
      return await this.prepareEyecatchFile(
        bytes,
        basename(payload.imagePath),
        payload,
      );
    }

    if (payload.imageUrl) {
      const response = await this.fetchImpl(payload.imageUrl);
      const body = await response.arrayBuffer();
      if (!response.ok) {
        throw new NoteApiError(
          `image download failed: ${response.status} ${response.statusText}`,
          response.status,
          null,
        );
      }
      if (body.byteLength > MAX_EYECATCH_BYTES) {
        throw new NoteApiError(
          "eyecatch image exceeds note.com's 10MB limit",
          400,
          {
            imageUrl: payload.imageUrl,
            size: body.byteLength,
            maxSize: MAX_EYECATCH_BYTES,
          },
        );
      }
      const filename =
        basename(new URL(payload.imageUrl).pathname) || "eyecatch.jpg";
      return await this.prepareEyecatchFile(
        Buffer.from(body),
        filename,
        payload,
      );
    }

    throw new NoteApiError("imagePath or imageUrl is required", 400, null);
  }

  private async prepareEyecatchFile(
    bytes: Buffer,
    filename: string,
    payload: UploadEyecatchPayload,
  ): Promise<File> {
    const targetWidth = payload.width ?? NOTE_EYECATCH_WIDTH;
    const targetHeight = payload.height ?? NOTE_EYECATCH_HEIGHT;
    const shouldTransform =
      payload.targetSize === "note-eyecatch" || payload.fit;

    if (!shouldTransform || payload.fit === "none") {
      return new File([bufferToArrayBuffer(bytes)], filename, {
        type: mimeType(filename),
      });
    }

    const fit = payload.fit === "contain" ? "contain" : "cover";
    const output = await sharp(bytes)
      .resize(targetWidth, targetHeight, {
        fit,
        position: "centre",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();

    if (output.byteLength > MAX_EYECATCH_BYTES) {
      throw new NoteApiError(
        "processed eyecatch image exceeds note.com's 10MB limit",
        400,
        {
          size: output.byteLength,
          maxSize: MAX_EYECATCH_BYTES,
          width: targetWidth,
          height: targetHeight,
        },
      );
    }

    return new File(
      [new Uint8Array(output)],
      replaceExtension(filename, ".jpg"),
      {
        type: "image/jpeg",
      },
    );
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<JsonValue> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("cookie", this.cookie);
    headers.set("user-agent", this.userAgent);
    headers.set("x-requested-with", "XMLHttpRequest");

    if (typeof init.body === "string" && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const method = init.method?.toUpperCase();
    if (method === "POST" || method === "PUT") {
      headers.set("origin", EDITOR_ORIGIN);
      headers.set("referer", EDITOR_REFERER);
    }

    const response = await this.fetchImpl(`${BASE_URL}${path}`, {
      ...init,
      headers,
    });

    const body = await parseBody(response);
    if (!response.ok) {
      const endpoint = `${BASE_URL}${path}`;
      const method = init.method?.toUpperCase() ?? "GET";
      throw new NoteApiError(
        noteApiErrorMessage(response, path, body),
        response.status,
        {
          endpoint,
          method,
          body,
        },
      );
    }

    return body;
  }
}


function noteApiErrorMessage(
  response: Response,
  path: string,
  body: JsonValue,
): string {
  const base = `note.com API request failed: ${response.status} ${response.statusText}`;
  if (isDraftSaveMissingId(path, body)) {
    return `${base}. draft_save requires a numeric draft id; use note_create_draft to create a new draft shell first, or pass draftId/noteKey when updating an existing draft.`;
  }
  return base;
}

function isDraftSaveMissingId(path: string, body: JsonValue): boolean {
  if (!path.startsWith("/v1/text_notes/draft_save")) return false;
  const id = new URL(path, BASE_URL).searchParams.get("id");
  if (id) return false;
  if (!isJsonObject(body)) return false;
  const error = firstString(body.error, body.message);
  return error?.toLowerCase().includes("id is missing") ?? false;
}

function extractDraft(payload: JsonValue): {
  [key: string]: JsonValue;
  id: string | number;
} {
  if (isJsonObject(payload) && isJsonObject(payload.data)) {
    const id = payload.data.id;
    if (typeof id === "number" || typeof id === "string") {
      return { ...payload.data, id };
    }
  }
  throw new NoteApiError(
    "note.com draft shell response did not include data.id",
    502,
    payload,
  );
}

function extractNoteData(payload: JsonValue): {
  [key: string]: JsonValue;
  id: string | number;
} {
  if (isJsonObject(payload) && isJsonObject(payload.data)) {
    const id = payload.data.id;
    if (typeof id === "number" || typeof id === "string") {
      return { ...payload.data, id };
    }
  }
  throw new NoteApiError(
    "note.com note response did not include data.id",
    502,
    payload,
  );
}

function draftSummary(draft: {
  [key: string]: JsonValue;
  id: string | number;
}): JsonValue {
  const key = firstString(draft.key, draft.noteKey);
  const urlname = firstString(draft.urlname) ?? urlnameFromUser(draft.user);
  return omitUndefined({
    id: draft.id,
    noteId: draft.id,
    key,
    noteKey: key,
    editUrl: key ? `https://note.com/notes/${key}/edit` : undefined,
    publicUrl:
      noteUrl(key, draft.user, "published") ??
      (urlname && key ? `https://note.com/${urlname}/n/${key}` : undefined),
    status: "draft",
    nextActions: key
      ? {
          uploadEyecatch: { tool: "note_upload_eyecatch", noteId: draft.id },
          publish: { tool: "note_publish_draft", noteKey: key },
        }
      : undefined,
  });
}

function publishSummary(
  published: JsonValue,
  fallbackNote: { [key: string]: JsonValue; id: string | number },
): JsonValue {
  const data =
    isJsonObject(published) && isJsonObject(published.data)
      ? published.data
      : published;
  const source = isJsonObject(data) ? data : {};
  const key = firstString(
    source.key,
    source.noteKey,
    fallbackNote.key,
    fallbackNote.noteKey,
  );
  const user = source.user ?? fallbackNote.user;
  const eyecatch = firstString(
    source.eyecatch,
    source.eyecatchUrl,
    source.eyecatch_url,
    fallbackNote.eyecatch,
    fallbackNote.eyecatchUrl,
    fallbackNote.eyecatch_url,
  );
  return omitUndefined({
    status: firstString(source.status) ?? "published",
    key,
    noteKey: key,
    noteUrl: noteUrl(key, user, "published"),
    eyecatch,
    publishedAt: firstDefined(
      source.publishedAt,
      source.published_at,
      source.publishAt,
      source.publish_at,
      fallbackNote.publishedAt,
      fallbackNote.published_at,
      fallbackNote.publishAt,
      fallbackNote.publish_at,
    ),
  });
}

function eyecatchSummary(
  uploaded: JsonValue,
  payload: UploadEyecatchPayload,
): JsonValue {
  const data =
    isJsonObject(uploaded) && isJsonObject(uploaded.data)
      ? uploaded.data
      : uploaded;
  const source = isJsonObject(data) ? data : {};
  const url = firstString(source.url, source.eyecatchUrl, source.eyecatch_url);
  return omitUndefined({
    noteId: payload.noteId,
    eyecatchUrl: url,
    url,
    width: payload.width ?? 1280,
    height: payload.height ?? 670,
  });
}

function publishPayload(note: {
  [key: string]: JsonValue;
  id: string | number;
}): { [key: string]: JsonValue } {
  const body = firstString(note.body) ?? "";
  return {
    author_ids: [],
    body_length: textLength(body),
    disable_comment: Boolean(
      note.disableComment ?? note.disable_comment ?? false,
    ),
    exclude_from_creator_top: Boolean(
      note.excludeFromCreatorTop ?? note.exclude_from_creator_top ?? false,
    ),
    exclude_ai_learning_reward: Boolean(
      note.excludeAiLearningReward ?? note.exclude_ai_learning_reward ?? false,
    ),
    translation_setting:
      note.translationSetting ?? note.translation_setting ?? null,
    free_body: body,
    hashtags: [],
    image_keys: [],
    index: false,
    is_refund: false,
    limited: false,
    magazine_ids: [],
    magazine_keys: [],
    name: firstString(note.name) ?? "",
    pay_body: "",
    price: typeof note.price === "number" ? note.price : 0,
    send_notifications_flag: Boolean(
      note.sendNotificationsFlag ?? note.send_notifications_flag ?? false,
    ),
    separator: note.separator ?? null,
    slug: note.slug ?? null,
    status: "published",
    stock_photo_image_id:
      note.stockPhotoImageId ?? note.stock_photo_image_id ?? null,
    owner_urlname: null,
    circle_permissions: null,
    discount_campaigns: [],
    lead_form: null,
    line_add_friend: null,
    line_add_friend_access_token: null,
    pro_coupon_keys: [],
  };
}

function mimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function replaceExtension(filename: string, extension: string): string {
  const base = filename.replace(/\.[^.]*$/, "");
  return `${base || "eyecatch"}${extension}`;
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function textLength(html: string): number {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim().length;
}

function summarizeNotePayload(
  payload: JsonValue,
  options: GetNoteOptions = {},
): JsonValue {
  if (!isJsonObject(payload)) return payload;
  const source = isJsonObject(payload.data) ? payload.data : payload;
  const summary = summarizeNoteObject(source, options);
  if (options.fields && options.fields.length > 0) {
    return pickFields(summary, options.fields);
  }
  return summary;
}

function summarizeNoteObject(
  note: { [key: string]: JsonValue },
  options: GetNoteOptions = {},
): JsonValue {
  const key = firstString(note.key, note.noteKey);
  const body = firstString(note.body, note.free_body, note.content);
  const status =
    firstDefined(note.status) ?? (options.draft ? "draft" : undefined);
  const eyecatch = firstString(
    note.eyecatch,
    note.eyecatchUrl,
    note.eyecatch_url,
    note.image,
  );
  return omitUndefined({
    id: firstDefined(note.id, note.noteId),
    key,
    status,
    name: firstString(note.name, note.title),
    noteUrl: noteUrl(key, note.user, status),
    eyecatch,
    eyecatch_width: firstDefined(note.eyecatch_width, note.eyecatchWidth),
    eyecatch_height: firstDefined(note.eyecatch_height, note.eyecatchHeight),
    bodyPreview:
      options.includeBody === true && body
        ? body
        : body
          ? body.slice(0, 300)
          : undefined,
    bodyLength: body ? textLength(body) : undefined,
    isDraft: status === "draft" || options.draft === true,
    canUpdate: firstDefined(note.can_update, note.canUpdate),
  });
}

function pickFields(
  value: JsonValue,
  fields: string[],
): { [key: string]: JsonValue } | JsonValue {
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    fields
      .filter((field) => value[field] !== undefined)
      .map((field) => [field, value[field] as JsonValue]),
  );
}

function bundleSummary(
  draft: { [key: string]: JsonValue },
  eyecatch: JsonValue | undefined,
): JsonValue {
  const noteId = firstDefined(draft.noteId, draft.id);
  const noteKey = firstString(draft.noteKey, draft.key);
  const eyecatchObject = isJsonObject(eyecatch) ? eyecatch : undefined;
  return omitUndefined({
    status: "draft",
    noteId,
    noteKey,
    noteUrl: firstString(draft.noteUrl, draft.publicUrl),
    eyecatch: eyecatchObject
      ? omitUndefined({
          set: Boolean(
            firstString(eyecatchObject.url, eyecatchObject.eyecatchUrl),
          ),
          url: firstString(eyecatchObject.url, eyecatchObject.eyecatchUrl),
          width: firstDefined(eyecatchObject.width),
          height: firstDefined(eyecatchObject.height),
        })
      : undefined,
  });
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
      firstString(item.url, item.noteUrl, item.note_url, item.path) ??
      noteUrl(key, item.user, item.status),
    publishAt: firstDefined(
      item.publishAt,
      item.publish_at,
      item.publishedAt,
      item.published_at,
    ),
    status: item.status,
    likeCount: firstDefined(item.likeCount, item.like_count),
    isAuthor: item.isAuthor,
  });
}

function firstDefined(
  ...values: Array<JsonValue | undefined>
): JsonValue | undefined {
  return values.find((value) => value !== undefined);
}

function firstString(
  ...values: Array<JsonValue | undefined>
): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function urlnameFromUser(user: JsonValue | undefined): string | undefined {
  return isJsonObject(user) ? firstString(user.urlname) : undefined;
}

function noteUrl(
  key: string | undefined,
  user: JsonValue | undefined,
  status: JsonValue | undefined,
): string | undefined {
  if (!key || status === "draft") return undefined;
  if (isJsonObject(user)) {
    const urlname = firstString(user.urlname);
    if (urlname) return `https://note.com/${urlname}/n/${key}`;
  }
  return `https://note.com/notes/${key}`;
}

function omitUndefined(record: Record<string, JsonValue | undefined>): {
  [key: string]: JsonValue;
} {
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, JsonValue] => entry[1] !== undefined,
    ),
  );
}

function isJsonObject(value: unknown): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
