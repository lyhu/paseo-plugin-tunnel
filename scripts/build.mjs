import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
// Paseo compiles index.client.tsx and index.server.ts separately for each runtime
// at install/reload. These bundles check that server dependencies resolve and the
// UI only touches modules Paseo exposes to client plugins.
await build({
  entryPoints: ["server/handlers.ts"],
  outfile: "dist/server.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["@getpaseo/plugin", "@getpaseo/plugin/server", "zod"],
});
await build({
  entryPoints: ["client/tunnel-view.tsx"],
  outfile: "dist/client.cjs",
  bundle: true,
  platform: "neutral",
  format: "cjs",
  target: "es2020",
  external: [
    "@getpaseo/plugin",
    "@getpaseo/plugin/client",
    "@getpaseo/plugin/client/react-native",
    "@getpaseo/plugin/client/ui",
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
