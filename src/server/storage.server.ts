import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  PersistedTunnelConfigSchema,
  type PersistedTunnelConfig,
} from "./config.server.js";

export interface TunnelStorage {
  load(): PersistedTunnelConfig;
  save(config: PersistedTunnelConfig): void;
}

export function defaultStoragePath(): string {
  return join(
    process.env.PASEO_HOME || join(homedir(), ".paseo"),
    "tunnel",
    "config.json",
  );
}

export class FileTunnelStorage implements TunnelStorage {
  constructor(readonly path = defaultStoragePath()) {}

  load(): PersistedTunnelConfig {
    if (!existsSync(this.path)) return {};
    // Never include a Zod error or file contents: both may contain credentials.
    try {
      const config = PersistedTunnelConfigSchema.parse(
        JSON.parse(readFileSync(this.path, "utf8")),
      );
      chmodSync(this.path, 0o600);
      return config;
    } catch {
      throw new Error(
        "Cannot read tunnel config. Check its JSON, field values and permissions.",
      );
    }
  }

  save(config: PersistedTunnelConfig): void {
    const parsed = PersistedTunnelConfigSchema.safeParse(config);
    if (!parsed.success) throw new Error("Invalid tunnel configuration");
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      const fd = openSync(temporary, "wx", 0o600);
      try {
        writeFileSync(fd, `${JSON.stringify(parsed.data, null, 2)}\n`);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(temporary, this.path);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
}
