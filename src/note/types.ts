export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface NoteClientOptions {
  cookie: string;
  userAgent?: string;
  fetch?: FetchLike;
}

export interface DraftPayload {
  title: string;
  body: string;
  hashtags?: string[];
  draftId?: string;
  bodyLength?: number;
  responseFormat?: ResponseFormat;
}

export type ResponseFormat = "summary" | "full";

export interface PublishDraftOptions {
  responseFormat?: ResponseFormat;
}

export interface UploadEyecatchPayload {
  noteId: string;
  imagePath?: string;
  imageUrl?: string;
  width?: number;
  height?: number;
  responseFormat?: ResponseFormat;
}

export interface ListMyNotesOptions {
  fields?: "full" | "summary";
  includeBody?: boolean | undefined;
  limit?: number | undefined;
}
