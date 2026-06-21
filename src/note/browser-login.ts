import { saveCookie } from './auth.js';
import { NoteClient } from './client.js';
import type { JsonValue } from './types.js';

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
}

export interface BrowserLoginOptions {
  timeoutMs?: number;
  headless?: boolean;
  save?: boolean;
}

export interface BrowserLoginResult extends Record<string, JsonValue> {
  authenticated: boolean;
  saved: boolean;
  cookiePreview: string;
  message: string;
}

export function cookiesToHeader(cookies: BrowserCookie[]): string {
  const noteCookies = cookies.filter((cookie) => isNoteDomain(cookie.domain));
  if (noteCookies.length === 0) {
    throw new Error('No note.com cookies were found in the browser session.');
  }

  return noteCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

export async function runBrowserLogin(options: BrowserLoginOptions = {}): Promise<BrowserLoginResult> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const headless = options.headless ?? process.env.NOTE_MCP_HEADLESS === 'true';
  const { chromium } = await importPlaywright();
  const browser = await chromium.launch({ headless });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://note.com/login', { waitUntil: 'domcontentloaded' });

    const deadline = Date.now() + timeoutMs;
    let lastCookie = '';
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);
      const cookie = cookiesToHeader(await context.cookies('https://note.com'));
      lastCookie = cookie;
      const client = new NoteClient({ cookie });
      try {
        await client.authCheck();
        if (options.save ?? true) {
          await saveCookie(cookie);
        }
        return {
          authenticated: true,
          saved: options.save ?? true,
          cookiePreview: previewCookie(cookie),
          message: 'note.com authentication configured from browser login.',
        };
      } catch {
        // Keep waiting until the user finishes login or timeout expires.
      }
    }

    throw new Error(
      lastCookie
        ? 'Timed out waiting for note.com authentication to become valid.'
        : 'Timed out waiting for note.com login cookies.',
    );
  } finally {
    await browser.close();
  }
}

async function importPlaywright(): Promise<typeof import('playwright')> {
  try {
    return await import('playwright');
  } catch (error) {
    throw new Error(
      `Browser login requires the optional "playwright" package and a usable desktop browser environment. Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isNoteDomain(domain: string): boolean {
  const normalized = domain.replace(/^\./, '').toLowerCase();
  return normalized === 'note.com' || normalized.endsWith('.note.com');
}

function previewCookie(cookie: string): string {
  if (cookie.length <= 8) return '********';
  return `${cookie.slice(0, 4)}…${cookie.slice(-4)}`;
}
