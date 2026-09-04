/**
 * End-to-end Tunnel integration test with real relay, E2EE, and HTTP clients.
 *
 * Tests the complete data path:
 * - HTTP client -> Egress listener
 * - Egress -> relay v2 WebSocket -> E2EE handshake
 * - Tunnel frames with flow control
 * - Ingress -> target HTTP service
 * - Response path with SSE streaming
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { TunnelSubsystem } from "./subsystem.server.js";
import {
  createInProcessRelay,
  type RelayHarness,
} from "./relay-test-support.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTunnelStorage } from "./storage.server.js";

function handleTargetRequest(req: IncomingMessage, res: ServerResponse): void {
  if (req.url === "/headers") {
    const repeated: string[] = [];
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      if (req.rawHeaders[index]?.toLowerCase() === "x-repeat") {
        repeated.push(req.rawHeaders[index + 1] ?? "");
      }
    }
    res.setHeader("set-cookie", ["first=1", "second=2"]);
    res.setHeader("connection", "x-response-drop");
    res.setHeader("x-response-drop", "remove-me");
    res.end(
      JSON.stringify({
        repeated,
        host: req.headers.host,
        forwardedFor: req.headers["x-forwarded-for"],
        forwardedHost: req.headers["x-forwarded-host"],
        forwardedProto: req.headers["x-forwarded-proto"],
        dropped: req.headers["x-drop"] ?? null,
      }),
    );
    return;
  }
  if (req.url === "/echo") {
    const hash = createHash("sha256");
    let bytes = 0;
    req.on("data", (chunk) => {
      hash.update(chunk);
      bytes += chunk.length;
    });
    req.once("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ bytes, sha256: hash.digest("hex") }));
    });
    return;
  }
  if (req.url === "/sse") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    res.flushHeaders();
    setTimeout(() => {
      res.write("data: first\n\n");
      setTimeout(() => res.end("data: second\n\n"), 100);
    }, 50);
    return;
  }
  if (req.url === "/cancel") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    const interval = setInterval(() => res.write("data: tick\n\n"), 20);
    res.once("close", () => clearInterval(interval));
    return;
  }
  res.writeHead(404);
  res.end("Not found");
}

function cancelAfterFirstChunk(port: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const req = httpRequest(`http://127.0.0.1:${port}/cancel`, (res) => {
      res.once("data", () => {
        req.destroy();
        resolve();
      });
    });
    req.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNRESET") {
        resolve();
        return;
      }
      reject(error);
    });
    req.end();
  });
}

async function waitForIdleDataConnections(
  runtime: TunnelSubsystem,
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (runtime.getMetrics().activeDataConnections === 0) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Tunnel data connections did not become idle");
}

describe("Tunnel E2E", () => {
  let paseoHome: string;
  let relay: RelayHarness;
  let target: Server;
  let targetPort: number;
  let subsystem: TunnelSubsystem;

  beforeAll(async () => {
    paseoHome = mkdtempSync(join(tmpdir(), "tunnel-e2e-"));
    relay = await createInProcessRelay();

    target = createServer(handleTargetRequest);
    target.listen(0, "127.0.0.1");
    await once(target, "listening");
    const addr = target.address();
    if (!addr || typeof addr === "string")
      throw new Error("Invalid target address");
    targetPort = addr.port;

    subsystem = new TunnelSubsystem({
      storage: new FileTunnelStorage(join(paseoHome, "config.json")),
      relayEndpoint: relay.httpBaseUrl,
      relayUseTls: false,
    });
  });

  afterAll(async () => {
    await subsystem.stop();
    target.close();
    await relay.stop();
    rmSync(paseoHome, { recursive: true, force: true });
  });

  it("forwards JSON request/response through E2EE relay", async () => {
    // Create ingress
    const ingressResult = await subsystem.createIngress({
      name: "test-ingress",
      targetOrigin: `http://127.0.0.1:${targetPort}`,
    });
    expect(ingressResult.state.ingresses).toHaveLength(1);
    const ingressId = ingressResult.state.ingresses[0]!.id;

    // Export offer
    const offer = await subsystem.exportRouteOffer(ingressId);

    // Create egress
    const egressResult = await subsystem.createEgress({
      name: "test-egress",
      listen: { host: "127.0.0.1", port: 0 },
      offer,
      access: { mode: "none" },
    });
    expect(egressResult.state.egresses).toHaveLength(1);
    const egress = egressResult.state.egresses[0]!;
    expect(egress.status).toBe("listening");

    // Send JSON request through egress
    const body = JSON.stringify({ test: "data", unicode: "流式" });
    const bodyBuffer = Buffer.from(body, "utf8");
    const expectedHash = createHash("sha256").update(bodyBuffer).digest("hex");

    const response = await fetch(
      `http://127.0.0.1:${egress.listen.port}/echo`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: bodyBuffer,
      },
    );

    expect(response.ok).toBe(true);
    const result = (await response.json()) as { bytes: number; sha256: string };
    expect(result.bytes).toBe(bodyBuffer.byteLength);
    expect(result.sha256).toBe(expectedHash);
  }, 10_000);

  it("forwards binary body with flow control", async () => {
    const state = subsystem.getState();
    const egress = state.egresses[0]!;

    // Send 2MB binary payload
    const body = Buffer.alloc(2 * 1024 * 1024);
    for (let i = 0; i < body.byteLength; i++) body[i] = i % 251;
    const expectedHash = createHash("sha256").update(body).digest("hex");

    const response = await fetch(
      `http://127.0.0.1:${egress.listen.port}/echo`,
      {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body,
      },
    );

    expect(response.ok).toBe(true);
    const result = (await response.json()) as { bytes: number; sha256: string };
    expect(result.bytes).toBe(body.byteLength);
    expect(result.sha256).toBe(expectedHash);
  }, 15_000);

  it("preserves repeated headers and rebuilds proxy headers", async () => {
    const egress = subsystem.getState().egresses[0]!;
    const observed = await new Promise<{
      body: string;
      rawHeaders: string[];
    }>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port: egress.listen.port,
          path: "/headers",
          headers: [
            "Host",
            "caller.example",
            "X-Repeat",
            "one",
            "X-Repeat",
            "two",
            "Connection",
            "x-drop",
            "X-Drop",
            "remove-me",
            "X-Forwarded-For",
            "untrusted",
          ],
        },
        async (response) => {
          const chunks: Buffer[] = [];
          for await (const chunk of response) chunks.push(Buffer.from(chunk));
          resolve({
            body: Buffer.concat(chunks).toString(),
            rawHeaders: response.rawHeaders,
          });
        },
      );
      req.once("error", reject);
      req.end();
    });

    const targetRequest = JSON.parse(observed.body) as {
      repeated: string[];
      host: string;
      forwardedFor: string;
      forwardedHost: string;
      forwardedProto: string;
      dropped: string | null;
    };
    expect(targetRequest.repeated).toEqual(["one", "two"]);
    expect(targetRequest.host).toBe(`127.0.0.1:${targetPort}`);
    expect(targetRequest.forwardedFor).toMatch(/127\.0\.0\.1$/);
    expect(targetRequest.forwardedHost).toBe("caller.example");
    expect(targetRequest.forwardedProto).toBe("http");
    expect(targetRequest.dropped).toBeNull();
    expect(observed.rawHeaders).toEqual(
      expect.arrayContaining([
        "set-cookie",
        "first=1",
        "set-cookie",
        "second=2",
      ]),
    );
    expect(
      observed.rawHeaders.map((value) => value.toLowerCase()),
    ).not.toContain("x-response-drop");
  });

  it("streams SSE first event before end", async () => {
    const state = subsystem.getState();
    const egress = state.egresses[0]!;

    const response = await fetch(`http://127.0.0.1:${egress.listen.port}/sse`);
    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const reader = response.body!.getReader();
    const { value: firstChunk } = await reader.read();
    if (!firstChunk)
      throw new Error("SSE stream closed before the first event");
    expect(Buffer.from(firstChunk).toString()).toContain("data: first");

    const chunks: Buffer[] = [Buffer.from(firstChunk!)];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }

    const fullBody = Buffer.concat(chunks).toString();
    expect(fullBody).toContain("data: second");
    expect(fullBody.indexOf("data: first")).toBeLessThan(
      fullBody.indexOf("data: second"),
    );
  }, 10_000);

  it("cleans up on client cancellation", async () => {
    const state = subsystem.getState();
    const egress = state.egresses[0]!;

    await cancelAfterFirstChunk(egress.listen.port);
    await waitForIdleDataConnections(subsystem);
    expect(subsystem.getMetrics()).toEqual({ activeDataConnections: 0 });
  }, 10_000);

  it("validates access token in header mode", async () => {
    // Create new egress with header auth
    const state = subsystem.getState();
    const ingress = state.ingresses[0]!;
    const offer = await subsystem.exportRouteOffer(ingress.id);

    const token = "test-token-12345";
    const egressResult = await subsystem.createEgress({
      name: "auth-egress",
      listen: { host: "127.0.0.1", port: 0 },
      offer,
      access: { mode: "header", token },
    });

    const egress = egressResult.state.egresses.find(
      (e) => e.name === "auth-egress",
    )!;

    // Request without token should fail
    const noTokenResponse = await fetch(
      `http://127.0.0.1:${egress.listen.port}/echo`,
      {
        method: "POST",
        body: "test",
      },
    );
    expect(noTokenResponse.status).toBe(401);

    // Request with wrong token should fail
    const wrongTokenResponse = await fetch(
      `http://127.0.0.1:${egress.listen.port}/echo`,
      {
        method: "POST",
        headers: { "x-paseo-access-token": "wrong" },
        body: "test",
      },
    );
    expect(wrongTokenResponse.status).toBe(401);

    // Request with correct token should succeed
    const body = Buffer.from("authenticated");
    const expectedHash = createHash("sha256").update(body).digest("hex");

    const goodResponse = await fetch(
      `http://127.0.0.1:${egress.listen.port}/echo`,
      {
        method: "POST",
        headers: { "x-paseo-access-token": token },
        body,
      },
    );

    expect(goodResponse.ok).toBe(true);
    const result = (await goodResponse.json()) as {
      bytes: number;
      sha256: string;
    };
    expect(result.bytes).toBe(body.byteLength);
    expect(result.sha256).toBe(expectedHash);
  }, 10_000);

  it("returns a fixed 502 for an invalid route capability", async () => {
    const ingress = subsystem.getState().ingresses[0]!;
    const offer = await subsystem.exportRouteOffer(ingress.id);
    const result = await subsystem.createEgress({
      name: "invalid-route-egress",
      listen: { host: "127.0.0.1", port: 0 },
      offer: { ...offer, routeSecret: "invalid-secret" },
      access: { mode: "none" },
    });
    const egress = result.state.egresses.find(
      (item) => item.name === "invalid-route-egress",
    )!;

    const response = await fetch(
      `http://127.0.0.1:${egress.listen.port}/echo`,
      {
        method: "POST",
        body: "secret body",
      },
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Tunnel request failed");
  });

  it("returns a fixed 502 when the target is unavailable", async () => {
    const unavailable = createServer();
    unavailable.listen(0, "127.0.0.1");
    await once(unavailable, "listening");
    const address = unavailable.address();
    if (!address || typeof address === "string")
      throw new Error("Invalid unavailable address");
    const unavailablePort = address.port;
    await new Promise<void>((resolve) => unavailable.close(() => resolve()));

    const ingressResult = await subsystem.createIngress({
      name: "unavailable-target",
      targetOrigin: `http://127.0.0.1:${unavailablePort}`,
    });
    const ingress = ingressResult.state.ingresses.find(
      (item) => item.name === "unavailable-target",
    )!;
    const offer = await subsystem.exportRouteOffer(ingress.id);
    const egressResult = await subsystem.createEgress({
      name: "unavailable-target-egress",
      listen: { host: "127.0.0.1", port: 0 },
      offer,
      access: { mode: "none" },
    });
    const egress = egressResult.state.egresses.find(
      (item) => item.name === "unavailable-target-egress",
    )!;

    const response = await fetch(`http://127.0.0.1:${egress.listen.port}/test`);

    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Tunnel request failed");
  });

  it("rejects CONNECT and Upgrade requests", async () => {
    const state = subsystem.getState();
    const egress = state.egresses[0]!;

    // CONNECT should be rejected
    const connectPromise = new Promise<number>((resolve) => {
      const req = httpRequest({
        hostname: "127.0.0.1",
        port: egress.listen.port,
        method: "CONNECT",
        path: "example.com:443",
      });
      req.once("connect", (res, socket) => {
        socket.destroy();
        resolve(res.statusCode ?? 0);
      });
      req.end();
    });
    expect(await connectPromise).toBe(400);

    // WebSocket Upgrade should be rejected
    const upgradePromise = new Promise<number>((resolve) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port: egress.listen.port,
          path: "/ws",
          headers: {
            upgrade: "websocket",
            connection: "upgrade",
          },
        },
        (res) => resolve(res.statusCode!),
      );
      req.end();
    });
    expect(await upgradePromise).toBe(400);
  }, 10_000);
});
