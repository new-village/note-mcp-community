import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { getPackageVersion } from "../src/version.js";

describe("getPackageVersion", () => {
  it("returns the package.json version used for MCP serverInfo", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      version: string;
    };

    expect(getPackageVersion()).toBe(packageJson.version);
  });
});
