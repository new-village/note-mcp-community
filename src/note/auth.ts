import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

import type { JsonValue } from './types.js';

const COOKIE_ENV_KEYS = ['NOTE_COOKIE', 'NOTE_SESSION_COOKIE'] as const;
const CONFIG_ENV_KEY = 'NOTE_MCP_CONFIG';

interface StoredConfig {
  cookie?: string;
  updatedAt?: string;
}

export interface AuthOptions {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  configPath?: string;
}

export class AuthRequiredError extends Error {
  constructor(message = 'note.com authentication is not configured.') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export interface AuthStatus extends Record<string, JsonValue> {
  configured: boolean;
  source: 'env' | 'config' | 'none';
  configPath: string;
  cookiePreview?: string;
  message: string;
  suggestedTools?: string[];
}

export async function readCookie(options: AuthOptions = {}): Promise<string> {
  const envCookie = readCookieFromEnvValue(options.env ?? process.env);
  if (envCookie) return envCookie;

  const storedCookie = await readCookieFromConfig(options);
  if (storedCookie) return storedCookie;

  throw new AuthRequiredError();
}

export function readCookieFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const cookie = readCookieFromEnvValue(env);
  if (cookie) return cookie;

  throw new AuthRequiredError(
    `Missing note.com cookie. Set ${COOKIE_ENV_KEYS.join(' or ')}, save one with note_set_cookie, or run note-mcp auth.`,
  );
}

export function hasCookie(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(readCookieFromEnvValue(env));
}

export async function authStatus(options: AuthOptions = {}): Promise<AuthStatus> {
  const env = options.env ?? process.env;
  const envCookie = readCookieFromEnvValue(env);
  const configPath = resolveConfigPath(options);
  if (envCookie) {
    return {
      configured: true,
      source: 'env',
      configPath,
      cookiePreview: previewCookie(envCookie),
      message: 'note.com cookie is configured from environment variables.',
    };
  }

  const configCookie = await readCookieFromConfig(options);
  if (configCookie) {
    return {
      configured: true,
      source: 'config',
      configPath,
      cookiePreview: previewCookie(configCookie),
      message: 'note.com cookie is configured from note-mcp config file.',
    };
  }

  return {
    configured: false,
    source: 'none',
    configPath,
    message:
      'note.com cookie is not configured. Use note_auth_login for browser login or note_set_cookie / NOTE_COOKIE for advanced setups.',
    suggestedTools: ['note_auth_login', 'note_set_cookie'],
  };
}

export async function saveCookie(cookie: string, options: AuthOptions = {}): Promise<AuthStatus> {
  const trimmed = cookie.trim();
  if (!trimmed) throw new Error('Cookie must not be empty.');

  const configPath = resolveConfigPath(options);
  await mkdir(dirname(configPath), { recursive: true });
  const config: StoredConfig = {
    cookie: trimmed,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return authStatus({ ...options, env: {} });
}

export async function clearStoredCookie(options: AuthOptions = {}): Promise<AuthStatus> {
  await rm(resolveConfigPath(options), { force: true });
  return authStatus({ ...options, env: {} });
}

export function resolveConfigPath(options: AuthOptions = {}): string {
  const env = options.env ?? process.env;
  return options.configPath ?? env[CONFIG_ENV_KEY] ?? join(homedir(), '.config', 'note-mcp', 'config.json');
}

function readCookieFromEnvValue(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string | null {
  for (const key of COOKIE_ENV_KEYS) {
    const value = env[key];
    if (value?.trim()) return value.trim();
  }
  return null;
}

async function readCookieFromConfig(options: AuthOptions): Promise<string | null> {
  try {
    const raw = await readFile(resolveConfigPath(options), 'utf8');
    const parsed = JSON.parse(raw) as StoredConfig;
    return parsed.cookie?.trim() || null;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function previewCookie(cookie: string): string {
  if (cookie.length <= 8) return '********';
  return `${cookie.slice(0, 4)}…${cookie.slice(-4)}`;
}
