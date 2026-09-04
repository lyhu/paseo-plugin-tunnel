// Integration check against an existing Paseo source checkout. Uses only a temporary daemon.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createInProcessRelay } from "../src/server/relay-test-support.ts";
import { FileTunnelStorage } from "../src/server/storage.server.ts";
import { createServer } from "node:http";
import { once } from "node:events";
import { build } from "esbuild";

const checkout = process.argv
  .slice(2)
  .find((argument) => !argument.startsWith("--"));
if (!checkout)
  throw new Error("Usage: tsx scripts/verify-host.mjs /path/to/paseo");
const fromHost = (file) =>
  import(pathToFileURL(path.join(checkout, file)).href);
const { createTestPaseoDaemon } = await fromHost(
  "packages/server/src/server/test-utils/paseo-daemon.ts",
);
const { DaemonClient } = await fromHost(
  "packages/server/src/server/test-utils/daemon-client.ts",
);
const root = await mkdtemp(path.join(tmpdir(), "tunnel-plugin-host-"));
const home = path.join(root, ".paseo");
await mkdir(home, { recursive: true });
process.env.PASEO_HOME = home;
const relay = await createInProcessRelay();
new FileTunnelStorage(path.join(home, "tunnel/config.json")).save({
  relay: { endpoint: relay.httpBaseUrl, useTls: false },
});
const target = createServer((_req, res) => res.end("plugin proxy works"));
target.listen(0, "127.0.0.1");
await once(target, "listening");
let daemon;
let client;
try {
  daemon = await createTestPaseoDaemon({
    paseoHomeRoot: root,
    pluginsEnabled: true,
    agentClients: {},
    mcpEnabled: false,
  });
  client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.7.2",
  });
  await client.connect();
  const plugin = await client.installDirectoryPlugin(path.resolve("."));
  assert.equal(plugin.status, "running");
  const rpc = (method, input = {}) =>
    client.invokePluginRpc("tunnel", method, input);
  if (process.argv.includes("--ui")) {
    const bundle = await build({
      entryPoints: ["scripts/preview.client.tsx"],
      bundle: true,
      write: false,
      platform: "browser",
      format: "iife",
      jsx: "automatic",
      alias: { "react-native": "react-native-web" },
      define: { "process.env.NODE_ENV": '"development"' },
    });
    const preview = createServer(async (req, res) => {
      try {
        if (req.url === "/rpc" && req.method === "POST") {
          let body = "";
          for await (const chunk of req) body += chunk;
          const { method, input } = JSON.parse(body);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(await rpc(method, input)));
          return;
        }
        if (req.url === "/client.js") {
          res.setHeader("Content-Type", "application/javascript");
          res.end(bundle.outputFiles[0].text);
          return;
        }
        res.setHeader("Content-Type", "text/html");
        res.end(
          '<!doctype html><html><head><title>HTTP Tunnel verification</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{height:100%;margin:0}#root{display:flex;flex-direction:column}</style></head><body><div id="root"></div><script src="/client.js"></script></body></html>',
        );
      } catch (error) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    preview.listen(0, "127.0.0.1");
    await once(preview, "listening");
    console.log(
      `PREVIEW http://127.0.0.1:${preview.address().port} TARGET http://127.0.0.1:${target.address().port}`,
    );
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
    preview.closeAllConnections();
    await new Promise((resolve) => preview.close(resolve));
  } else {
    assert.deepEqual(await rpc("tunnel.state.get"), {
      relayStatus: "inactive",
      ingresses: [],
      egresses: [],
    });
    const created = await rpc("tunnel.ingress.create", {
      name: "host smoke",
      targetOrigin: `http://127.0.0.1:${target.address().port}`,
    });
    const { offer } = await rpc("tunnel.ingress.offer.export", {
      id: created.state.ingresses[0].id,
    });
    // Reserve a free port; the production RPC intentionally rejects port zero.
    const probe = createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const egress = await rpc("tunnel.egress.create", {
      name: "host listener",
      listen: { host: "127.0.0.1", port },
      offerString: offer,
      accessMode: "header",
    });
    const headers = { "X-Paseo-Access-Token": egress.oneTimeToken };
    assert.equal(
      await (await fetch(`http://127.0.0.1:${port}`, { headers })).text(),
      "plugin proxy works",
    );
    assert.equal((await client.reloadPlugin("tunnel")).status, "running");
    // The first RPC waits for startup, including restoring the relay control connection.
    await rpc("tunnel.state.get");
    assert.equal(
      await (await fetch(`http://127.0.0.1:${port}`, { headers })).text(),
      "plugin proxy works",
    );
    await client.disablePlugin("tunnel");
    await assert.rejects(fetch(`http://127.0.0.1:${port}`, { headers }));
    assert.equal((await client.enablePlugin("tunnel")).status, "running");
    await rpc("tunnel.state.get");
    assert.equal(
      await (await fetch(`http://127.0.0.1:${port}`, { headers })).text(),
      "plugin proxy works",
    );
    await client.removePlugin("tunnel");
    assert.deepEqual(await client.listPlugins(), []);
    console.log(
      "PASS: real Paseo subprocess install, RPC, E2EE proxy, reload, disable, enable and remove",
    );
  }
} finally {
  await client?.close();
  await daemon?.close();
  target.closeAllConnections();
  await new Promise((resolve) => target.close(resolve));
  await relay.stop();
  await rm(root, { recursive: true, force: true });
}
