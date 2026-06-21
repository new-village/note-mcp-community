import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  authStatus,
  clearStoredCookie,
  readCookie,
  saveCookie,
} from "../src/note/auth.js";

const tempDirs: string[] = [];

async function tempConfigPath() {
  const dir = await mkdtemp(join(tmpdir(), "note-mcp-community-test-"));
  tempDirs.push(dir);
  return join(dir, "config.json");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("note auth storage", () => {
  it("prefers NOTE_COOKIE over stored config cookie", async () => {
    const configPath = await tempConfigPath();
    await saveCookie("stored=1", { configPath });

    await expect(
      readCookie({ env: { NOTE_COOKIE: "env=1" }, configPath }),
    ).resolves.toBe("env=1");
  });

  it("reads cookie from config file when env is absent", async () => {
    const configPath = await tempConfigPath();
    await saveCookie("stored=1", { configPath });

    await expect(readCookie({ env: {}, configPath })).resolves.toBe("stored=1");
  });

  it("saves config file without leaking cookie in status", async () => {
    const configPath = await tempConfigPath();
    await saveCookie("session=secret-cookie-value", { configPath });

    const mode = (await stat(configPath)).mode & 0o777;
    expect(mode).toBe(0o600);
    await expect(readFile(configPath, "utf8")).resolves.toContain(
      "session=secret-cookie-value",
    );

    await expect(authStatus({ env: {}, configPath })).resolves.toEqual(
      expect.objectContaining({
        configured: true,
        source: "config",
        cookiePreview: "sess…alue",
      }),
    );
  });

  it("clears stored cookie", async () => {
    const configPath = await tempConfigPath();
    await saveCookie("stored=1", { configPath });
    await clearStoredCookie({ configPath });

    await expect(authStatus({ env: {}, configPath })).resolves.toEqual(
      expect.objectContaining({ configured: false }),
    );
  });
});
