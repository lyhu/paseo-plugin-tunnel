import { Miniflare, Log, LogLevel } from "miniflare";
import { build } from "esbuild";

export interface RelayHarness {
  httpBaseUrl: string;
  stop(): Promise<void>;
}

// Run the production Cloudflare Relay in workerd, with no mocked WebSocket transport.
export async function createInProcessRelay(): Promise<RelayHarness> {
  const built = await build({
    entryPoints: ["node_modules/@getpaseo/relay/dist/cloudflare-adapter.js"],
    bundle: true,
    format: "esm",
    platform: "neutral",
    write: false,
  });
  const relay = new Miniflare({
    modules: true,
    script: built.outputFiles[0].text,
    compatibilityDate: "2025-01-01",
    durableObjects: {
      RELAY: { className: "RelayDurableObject", useSQLite: true },
    },
    host: "127.0.0.1",
    port: 0,
    log: new Log(LogLevel.ERROR),
  });
  const url = await relay.ready;
  return { httpBaseUrl: url.origin, stop: () => relay.dispose() };
}
