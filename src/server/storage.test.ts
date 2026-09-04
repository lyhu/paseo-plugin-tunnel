import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTunnelStorage } from "./storage.server.js";
import { createTunnelIdentity } from "./config.server.js";

const paths: string[] = [];
function store() {
  const path = mkdtempSync(join(tmpdir(), "tunnel-storage-"));
  paths.push(path);
  return new FileTunnelStorage(join(path, "tunnel", "config.json"));
}
afterEach(() => {
  for (const path of paths.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe("independent tunnel storage", () => {
  it("atomically persists and reloads private configuration", () => {
    const storage = store();
    expect(storage.load()).toEqual({});
    const config = {
      identity: createTunnelIdentity(),
      ingresses: [],
      egresses: [],
    };
    storage.save(config);
    expect(new FileTunnelStorage(storage.path).load()).toEqual(config);
    expect(statSync(storage.path).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(storage.path, ".."))).toEqual(["config.json"]);
    expect(JSON.parse(readFileSync(storage.path, "utf8"))).toEqual(config);
  });
  it("rejects damaged configuration without replacing it or exposing secrets", () => {
    const storage = store();
    storage.save({});
    writeFileSync(storage.path, '{"secret":"DO-NOT-EXPOSE"');
    expect(() => storage.load()).toThrow(
      "Cannot read tunnel config. Check its JSON, field values and permissions.",
    );
    expect(readFileSync(storage.path, "utf8")).toBe(
      '{"secret":"DO-NOT-EXPOSE"',
    );
  });
});
