import { saveCookie, type AuthStatus } from "./auth.js";
import { NoteClient } from "./client.js";
import type { JsonValue } from "./types.js";

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
  configPath?: string;
}

export function cookiesToHeader(cookies: BrowserCookie[]): string {
  const noteCookies = cookies.filter((cookie) => isNoteDomain(cookie.domain));
  if (noteCookies.length === 0) {
    throw new Error("No note.com cookies were found in the browser session.");
  }

  return noteCookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

export async function runBrowserLogin(
  options: BrowserLoginOptions = {},
): Promise<BrowserLoginResult> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const headless =
    options.headless ?? process.env.NOTE_MCP_COMMUNITY_HEADLESS === "true";
  const { chromium } = await importPlaywright();
  let browser;
  try {
    browser = await chromium.launch({ headless });
  } catch (error) {
    throw toBrowserLoginError(error);
  }

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("https://note.com/login", {
      waitUntil: "domcontentloaded",
    });

    const deadline = Date.now() + timeoutMs;
    let lastCookie = "";
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);
      const cookie = cookiesToHeader(await context.cookies("https://note.com"));
      lastCookie = cookie;
      const client = new NoteClient({ cookie });
      try {
        await client.authCheck();
        const shouldSave = options.save ?? true;
        const saveStatus = shouldSave ? await saveCookie(cookie) : undefined;
        return buildBrowserLoginResult(cookie, shouldSave, saveStatus);
      } catch {
        // Keep waiting until the user finishes login or timeout expires.
      }
    }

    throw new Error(
      lastCookie
        ? "Timed out waiting for note.com authentication to become valid."
        : "Timed out waiting for note.com login cookies.",
    );
  } finally {
    await browser.close();
  }
}

async function importPlaywright(): Promise<typeof import("playwright")> {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(
      `Browser login requires the optional "playwright" package and a usable desktop browser environment. Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function buildBrowserLoginResult(
  cookie: string,
  saved: boolean,
  saveStatus?: Pick<AuthStatus, "configPath" | "cookiePreview">,
): BrowserLoginResult {
  const configPath = saveStatus?.configPath;
  return {
    authenticated: true,
    saved,
    ...(configPath ? { configPath } : {}),
    cookiePreview: saveStatus?.cookiePreview ?? previewCookie(cookie),
    message: configPath
      ? `note.com authentication configured from browser login. Cookie saved to ${configPath}.`
      : "note.com authentication configured from browser login.",
  };
}

export function toBrowserLoginError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("Executable doesn't exist") ||
    message.includes(
      "Please run the following command to download new browsers",
    ) ||
    message.includes("playwright install")
  ) {
    return new Error(
      [
        "Playwright browser is not installed, so note-mcp-community cannot open the note.com browser login flow.",
        "Run this once on the same machine/user account, then retry:",
        "  npx playwright install chromium",
        "If you are running note-mcp-community through npx and Playwright is not otherwise installed, use:",
        "  npx -p playwright playwright install chromium",
        "For remote servers, containers, or CI, prefer NOTE_COOKIE / NOTE_SESSION_COOKIE or NOTE_MCP_COMMUNITY_CONFIG instead of browser login.",
      ].join("\n"),
    );
  }

  return error instanceof Error ? error : new Error(message);
}

function isNoteDomain(domain: string): boolean {
  const normalized = domain.replace(/^\./, "").toLowerCase();
  return normalized === "note.com" || normalized.endsWith(".note.com");
}

function previewCookie(cookie: string): string {
  if (cookie.length <= 8) return "********";
  return `${cookie.slice(0, 4)}…${cookie.slice(-4)}`;
}
