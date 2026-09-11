import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { PLUGIN_VERSION } from "./version";

test("PLUGIN_VERSION matches the packaged version", () => {
  const manifest: { version: string } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  expect(PLUGIN_VERSION).toBe(manifest.version);
});
