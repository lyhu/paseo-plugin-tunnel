import { createServer, request, Agent } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInProcessRelay } from "../src/server/relay-test-support.ts";

// A separate checkout permits comparing identical fixtures against another revision.
const source = resolve(process.env.BENCH_SOURCE_ROOT ?? ".");
const { TunnelSubsystem } = await import(
  pathToFileURL(join(source, "src/server/subsystem.server.ts"))
);
const { FileTunnelStorage } = await import(
  pathToFileURL(join(source, "src/server/storage.server.ts"))
);
const { EgressRuntime } = await import(
  pathToFileURL(join(source, "src/server/egress-runtime.server.ts"))
);
const root = await mkdtemp(join(tmpdir(), "tunnel-benchmark-"));
const external = process.env.BENCH_RELAY_ENDPOINT;
// Relay harness diagnostics contain temporary connection identifiers. Keep output aggregate-only.
console.log = () => {};
const relay = external ? null : await createInProcessRelay();
const target = createServer((req, res) => {
  if (req.url === "/sse") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.flushHeaders();
    let count = 0;
    const timer = setInterval(() => {
      res.write(
        `data: ${JSON.stringify({ sequence: count++, text: "x".repeat(200) })}\n\n`,
      );
      if (count === 100) {
        clearInterval(timer);
        res.end();
      }
    }, 10);
    res.once("close", () => clearInterval(timer));
  } else res.end(Buffer.alloc(req.url === "/large" ? 1024 * 1024 : 256, 97));
});
target.listen(0, "127.0.0.1");
await once(target, "listening");
const ingress = new TunnelSubsystem({
  storage: new FileTunnelStorage(join(root, "config.json")),
  relayEndpoint: external ?? relay.httpBaseUrl,
  relayUseTls: external ? process.env.BENCH_RELAY_TLS !== "false" : false,
});
const agent = new Agent({ keepAlive: true });
let egress;
async function measure(url) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(
      () => req.destroy(new Error("Benchmark timeout")),
      30000,
    );
    const req = request(url, { agent }, (res) => {
      const headersMs = performance.now() - start;
      let bytes = 0,
        firstBodyMs = null,
        last = null;
      const gaps = [];
      res.on("data", (chunk) => {
        const now = performance.now() - start;
        firstBodyMs ??= now;
        if (last !== null) gaps.push(now - last);
        last = now;
        bytes += chunk.length;
      });
      res.on("error", reject);
      res.on("end", () =>
        res.statusCode === 200
          ? resolve({
              headersMs,
              firstBodyMs,
              totalMs: performance.now() - start,
              maxChunkGapMs: Math.max(0, ...gaps),
              bytes,
            })
          : reject(new Error(`HTTP ${res.statusCode}`)),
      );
    });
    req.once("close", () => clearTimeout(deadline));
    req.once("error", () => reject(new Error("Benchmark transport failed")));
    req.end();
  });
}
try {
  const direct = `http://127.0.0.1:${target.address().port}`;
  const created = await ingress.createIngress({
    name: "benchmark",
    targetOrigin: direct,
  });
  const offer = await ingress.exportRouteOffer(created.state.ingresses[0].id);
  egress = new EgressRuntime({
    ...offer,
    listen: { host: "127.0.0.1", port: 0 },
    access: { mode: "none" },
    preconnectCount: process.env.BENCH_PRECONNECT === "0" ? 0 : 2,
  });
  await egress.start();
  const proxy = `http://127.0.0.1:${egress.getActualPort()}`;
  for (const path of ["/small", "/large", "/sse"]) {
    const samples = { direct: [], tunnel: [] };
    for (let round = 0; round < 6; round++) {
      // Identical pacing for both revisions; permits prepared channels to become ready.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      for (const [label, url] of [
        ["direct", direct],
        ["tunnel", proxy],
      ])
        samples[label].push(await measure(url + path));
    }
    const summary = {};
    for (const [label, values] of Object.entries(samples)) {
      summary[label] = {};
      for (const key of [
        "headersMs",
        "firstBodyMs",
        "totalMs",
        "maxChunkGapMs",
        "bytes",
      ]) {
        summary[label][key] = +values
          .slice(1)
          .map((value) => value[key])
          .sort((a, b) => a - b)[2]
          .toFixed(2);
      }
    }
    process.stdout.write(
      `${JSON.stringify({ fixture: path.slice(1), relay: external ? "network" : "loopback", summary, samples })}\n`,
    );
  }
} finally {
  agent.destroy();
  await egress?.stop();
  await ingress.stop();
  target.closeAllConnections();
  await new Promise((resolve) => target.close(resolve));
  await relay?.stop();
  await rm(root, { recursive: true, force: true });
}
