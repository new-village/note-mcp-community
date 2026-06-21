import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function getPackageVersion(): string {
  try {
    const packageJson = require("../package.json") as { version?: unknown };
    return typeof packageJson.version === "string"
      ? packageJson.version
      : "0.0.0-development";
  } catch {
    return "0.0.0-development";
  }
}
