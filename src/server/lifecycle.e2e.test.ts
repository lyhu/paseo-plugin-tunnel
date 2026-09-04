import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer } from "node:http";
import {
  createServer as createTcpServer,
  connect,
  type Socket,
} from "node:net";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInProcessRelay,
  type RelayHarness,
} from "./relay-test-support.js";
import { FileTunnelStorage } from "./storage.server.js";
import { TunnelSubsystem } from "./subsystem.server.js";
import { IngressRuntime } from "./ingress-runtime.server.js";
import { generateKeyPair } from "@getpaseo/relay/e2ee";
import { parseRouteOffer } from "./offer.server.js";

let relay: RelayHarness;
let root: string;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "tunnel-lifecycle-"));
  relay = await createInProcessRelay();
});
afterAll(async () => {
  await relay.stop();
  rmSync(root, { recursive: true, force: true });
});

function host(name: string) {
  return new TunnelSubsystem({
    storage: new FileTunnelStorage(join(root, name, "config.json")),
    relayEndpoint: relay.httpBaseUrl,
    relayUseTls: false,
  });
}

it("transfers an offer between independent hosts, redacts credentials, rotates, disables, and restores listeners", async () => {
  const target = createServer((req, res) =>
    res.end(
      JSON.stringify({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization ?? null,
        token: req.headers["x-paseo-access-token"] ?? null,
      }),
    ),
  );
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  const address = target.address();
  if (!address || typeof address === "string")
    throw new Error("Missing target port");
  const ingress = host("ingress");
  let egress = host("egress");
  try {
    const created = await ingress.createIngress({
      name: "API",
      targetOrigin: `http://127.0.0.1:${address.port}`,
    });
    const id = created.state.ingresses[0].id;
    const offer = parseRouteOffer(
      JSON.stringify(await ingress.exportRouteOffer(id)),
    );
    const result = await egress.createEgress({
      name: "public API",
      listen: { host: "127.0.0.1", port: 0 },
      offer,
      access: { mode: "bearer", token: "initial-test-token" },
    });
    const listener = result.state.egresses[0];
    const url = `http://127.0.0.1:${listener.listen.port}/hello?name=test`;
    expect(result.oneTimeToken).toBe("initial-test-token");
    expect(JSON.stringify(egress.getState())).not.toMatch(
      /routeSecret|tokenHash|initial-test-token|secretKey/,
    );
    expect((await fetch(url)).status).toBe(401);
    for (const method of ["GET", "POST", "PUT", "DELETE"]) {
      const response = await fetch(url, {
        method,
        headers: { Authorization: "Bearer initial-test-token" },
      });
      expect(await response.json()).toEqual({
        method,
        url: "/hello?name=test",
        auth: null,
        token: null,
      });
    }
    const rotated = await egress.rotateEgressToken(listener.id, {
      mode: "header",
    });
    expect(rotated.oneTimeToken).toMatch(/^ptt-/);
    expect(
      (
        await fetch(url, {
          headers: { Authorization: "Bearer initial-test-token" },
        })
      ).status,
    ).toBe(401);
    const headers = { "X-Paseo-Access-Token": rotated.oneTimeToken! };
    expect((await fetch(url, { headers })).status).toBe(200);
    await ingress.rotateIngressSecret(id);
    expect((await fetch(url, { headers })).status).toBe(502);
    await egress.replaceEgressOffer(
      listener.id,
      parseRouteOffer(JSON.stringify(await ingress.exportRouteOffer(id))),
    );
    expect((await fetch(url, { headers })).status).toBe(200);
    await egress.updateEgress({ id: listener.id, enabled: false });
    expect(egress.getState().egresses[0].status).toBe("disabled");
    await expect(fetch(url, { headers })).rejects.toThrow();
    await egress.updateEgress({ id: listener.id, enabled: true });
    await egress.stop();
    egress = host("egress");
    await egress.start();
    expect((await fetch(url, { headers })).status).toBe(200);
    await egress.deleteEgress(listener.id);
    await ingress.deleteIngress(id);
    expect(egress.getState().egresses).toEqual([]);
    expect(ingress.getState().relayStatus).toBe("inactive");
  } finally {
    await egress.stop();
    await ingress.stop();
    target.closeAllConnections();
    await new Promise<void>((resolve) => target.close(() => resolve()));
  }
}, 15000);

it("releases an idle, incomplete HTTP connection when stopped", async () => {
  const egress = host("slow-client");
  let socket: Socket | undefined;
  try {
    const identityHost = host("offer-source");
    const created = await identityHost.createIngress({
      name: "local",
      targetOrigin: "http://127.0.0.1:1",
    });
    const offer = await identityHost.exportRouteOffer(
      created.state.ingresses[0].id,
    );
    await identityHost.stop();
    const result = await egress.createEgress({
      name: "listener",
      listen: { host: "127.0.0.1", port: 0 },
      offer,
      access: { mode: "none" },
    });
    const port = result.state.egresses[0].listen.port;
    socket = connect(port, "127.0.0.1");
    await once(socket, "connect");
    socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n");
    // Forced shutdown may reset the incomplete request instead of sending FIN.
    socket.once("error", () => undefined);
    const closed = new Promise<void>((resolve) =>
      socket!.once("close", () => resolve()),
    );
    await egress.stop();
    await closed;
    const replacement = createTcpServer();
    replacement.listen(port, "127.0.0.1");
    await once(replacement, "listening");
    await new Promise<void>((resolve) => replacement.close(() => resolve()));
  } finally {
    socket?.destroy();
    await egress.stop();
  }
}, 5000);

it("cancels a pending relay handshake on stop", async () => {
  const sockets = new Set<Socket>();
  const stalled = createTcpServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  stalled.listen(0, "127.0.0.1");
  await once(stalled, "listening");
  const address = stalled.address();
  if (!address || typeof address === "string")
    throw new Error("Missing relay port");
  const runtime = new IngressRuntime({
    relayEndpoint: `127.0.0.1:${address.port}`,
    relayUseTls: false,
    tunnelServerId: "cancel-test",
    tunnelKeyPair: generateKeyPair(),
    routes: [],
    readyTimeoutMs: 10000,
  });
  try {
    const connected = once(stalled, "connection");
    const started = runtime.start();
    const rejected = expect(started).rejects.toThrow("Tunnel stopped");
    await connected;
    await runtime.stop();
    await rejected;
  } finally {
    await runtime.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => stalled.close(() => resolve()));
  }
}, 2000);
