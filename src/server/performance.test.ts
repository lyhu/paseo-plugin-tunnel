import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInProcessRelay, type RelayHarness } from "./relay-test-support";
import { TunnelSubsystem } from "./subsystem.server";
import { FileTunnelStorage } from "./storage.server";
import { EgressRuntime } from "./egress-runtime.server";
import { EncryptedChannel } from "@getpaseo/relay/e2ee";
import { createHash } from "node:crypto";

let relay: RelayHarness;
let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "tunnel-performance-"));
  relay = await createInProcessRelay();
});
afterAll(async () => {
  await relay.stop();
  await rm(root, { recursive: true, force: true });
});

async function until(check: () => boolean) {
  const end = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > end) throw new Error("Condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function fixture(name: string, idleMs = 30000) {
  let calls = 0;
  const body = Buffer.alloc(2 * 1024 * 1024, 97);
  const target = createServer(async (req, res) => {
    calls++;
    let bytes = 0;
    try {
      for await (const chunk of req) bytes += chunk.length;
    } catch {
      return;
    }
    if (req.url === "/download") res.end(body);
    else res.end(JSON.stringify({ url: req.url, bytes }));
  });
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  const address = target.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  const ingress = new TunnelSubsystem({
    storage: new FileTunnelStorage(join(root, name, "config.json")),
    relayEndpoint: relay.httpBaseUrl,
    relayUseTls: false,
  });
  const created = await ingress.createIngress({
    name,
    targetOrigin: `http://127.0.0.1:${address.port}`,
  });
  const offer = await ingress.exportRouteOffer(created.state.ingresses[0].id);
  const egress = new EgressRuntime({
    ...offer,
    listen: { host: "127.0.0.1", port: 0 },
    access: {
      mode: "header",
      tokenHash: createHash("sha256").update("test-token").digest("hex"),
    },
    preconnectIdleMs: idleMs,
  });
  await egress.start();
  return {
    egress,
    body,
    calls: () => calls,
    url: `http://127.0.0.1:${egress.getActualPort()}`,
    headers: { "X-Paseo-Access-Token": "test-token" },
    async close() {
      await egress.stop();
      await ingress.stop();
      target.closeAllConnections();
      await new Promise<void>((resolve) => target.close(() => resolve()));
    },
  };
}

it("prepares bounded channels without contacting the origin and authenticates before leasing", async () => {
  const f = await fixture("preconnect");
  try {
    await until(() => f.egress.getMetrics().preparedConnections === 2);
    expect(f.calls()).toBe(0);
    expect((await fetch(f.url)).status).toBe(401);
    expect(f.egress.getMetrics().preconnectHits).toBe(0);
    const results = await Promise.all(
      ["/one", "/two"].map(async (path) => {
        const res = await fetch(f.url + path, { headers: f.headers });
        return res.json();
      }),
    );
    expect(results).toEqual([
      { url: "/one", bytes: 0 },
      { url: "/two", bytes: 0 },
    ]);
    expect(f.egress.getMetrics().preconnectHits).toBe(2);
    expect(f.calls()).toBe(2);
  } finally {
    await f.close();
  }
  expect(f.egress.getMetrics().activeDataConnections).toBe(0);
});

it("expires idle channels without reconnecting in a background loop", async () => {
  const f = await fixture("expiration", 150);
  try {
    await until(() => f.egress.getMetrics().preparedConnections === 2);
    await until(() => f.egress.getMetrics().activeDataConnections === 0);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(f.egress.getMetrics().totalDataConnections).toBe(2);
    expect(f.calls()).toBe(0);
    const response = await fetch(`${f.url}/cold`, { headers: f.headers });
    expect(await response.json()).toEqual({ url: "/cold", bytes: 0 });
  } finally {
    await f.close();
  }
});

it.each(["request", "response"] as const)(
  "slides the %s window after the oldest ACK instead of waiting for the whole batch",
  async (direction) => {
    const f = await fixture(`window-${direction}`);
    const send = EncryptedChannel.prototype.send;
    const roles = new WeakMap<EncryptedChannel, string>();
    let blocked = true;
    let bodies = 0;
    const releases: (() => void)[] = [];
    const spy = vi
      .spyOn(EncryptedChannel.prototype, "send")
      .mockImplementation(async function (this: EncryptedChannel, data) {
        if (typeof data === "string") {
          const frame = JSON.parse(data);
          if (frame.type === "request.head") roles.set(this, "request");
          if (frame.type === "response.head") roles.set(this, "response");
          if (frame.type === `${direction}.ack` && blocked) {
            await new Promise<void>((resolve) => releases.push(resolve));
          }
        } else if (roles.get(this) === direction) bodies++;
        return send.call(this, data);
      });
    let pending: Promise<unknown> | undefined;
    try {
      pending = fetch(
        f.url + (direction === "request" ? "/upload" : "/download"),
        {
          method: direction === "request" ? "POST" : "GET",
          headers: f.headers,
          body: direction === "request" ? f.body : undefined,
        },
      ).then((response) => response.arrayBuffer());
      await until(() => releases.length === 8);
      expect(bodies).toBe(8);
      releases.shift()?.();
      await until(() => bodies === 9);
      // The other seven acknowledgements remain blocked while the ninth frame arrives.
      blocked = false;
      for (const release of releases) release();
      await pending;
      expect(f.calls()).toBe(1);
    } finally {
      blocked = false;
      for (const release of releases) release();
      await f.close();
      await pending?.catch(() => undefined);
      spy.mockRestore();
    }
  },
);
