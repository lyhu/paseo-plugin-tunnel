import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
// Paseo compiles index.ts separately for each runtime at install/reload.
// These bundles check that server dependencies resolve and the UI remains portable.
await build({
  entryPoints: ["src/server/handlers.server.ts"],
  outfile: "dist/server.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["@getpaseo/plugin/server", "zod"],
});
await build({
  entryPoints: ["src/client/tunnel-view.client.tsx"],
  outfile: "dist/client.cjs",
  bundle: true,
  platform: "neutral",
  format: "cjs",
  target: "es2020",
  external: [
    "@getpaseo/plugin",
    "@getpaseo/plugin/server",
    "react",
    "react/jsx-runtime",
    "react-native",
    "@tanstack/react-query",
    "zod",
  ],
});
console.log(
  "Server and client dependencies compiled. Install the source directory with Paseo.",
);
