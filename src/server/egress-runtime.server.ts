/**
 * Egress runtime: HTTP listener that creates per-request E2EE data connections
 * to Ingress through relay.
 */

import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { once } from "node:events";
import { WebSocket, type RawData } from "ws";
import {
  createClientChannel,
  type EncryptedChannel,
} from "@getpaseo/relay/e2ee";
import {
  decodeTunnelFrame,
  encodeTunnelFrame,
  TunnelCreditWindow,
  TunnelStreamOrder,
  FRAME_BYTES,
  FLOW_WINDOW_CHUNKS,
  type TunnelFrame,
} from "./tunnel-wire.server.js";
import {
  rawHeadersToTuples,
  sanitizeTunnelHeaders,
  tuplesToRawHeaders,
} from "./http-headers.server.js";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { buildTunnelRelayUrl } from "./relay-url.server.js";
import type { TunnelListenHost } from "./config.server.js";

export interface EgressRuntimeOptions {
  listen: { host: TunnelListenHost; port: number };
  relayEndpoint: string;
  relayUseTls: boolean;
  tunnelServerId: string;
  tunnelPublicKeyB64: string;
  routeId: string;
  routeSecret: string;
  access: {
    mode: "bearer" | "header" | "none";
    tokenHash?: string;
  };
  onMetrics?: (metrics: EgressMetrics) => void;
  readyTimeoutMs?: number;
  preconnectCount?: 0 | 1 | 2;
  preconnectIdleMs?: number;
}

export interface EgressMetrics {
  activeDataConnections: number;
  totalDataConnections: number;
  preparedConnections: number;
  preconnectHits: number;
}

interface PendingAcknowledgement {
  bytes: number;
  completed: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface DataConnection {
  id: string;
  ws: WebSocket;
  channel: EncryptedChannel | null;
  requestWindow: TunnelCreditWindow;
  responseWindow: TunnelCreditWindow;
  pendingRequestAcks: PendingAcknowledgement[];
  responseOrder: TunnelStreamOrder;
  finished: boolean;
  readyTimeout: ReturnType<typeof setTimeout> | null;
  idleTimeout: ReturnType<typeof setTimeout> | null;
  request: { req: IncomingMessage; res: ServerResponse } | null;
  started: boolean;
  fail: () => void;
}

export class EgressRuntime {
  #server: Server;
  #listen: { host: TunnelListenHost; port: number };
  #relayEndpoint: string;
  #relayUseTls: boolean;
  #tunnelServerId: string;
  #tunnelPublicKeyB64: string;
  #routeId: string;
  #routeSecret: string;
  #access: { mode: "bearer" | "header" | "none"; tokenHash?: string };
  #dataConnections = new Map<string, DataConnection>();
  #actualPort = 0;
  #onMetrics?: (metrics: EgressMetrics) => void;
  #totalDataConnections = 0;
  #readyTimeoutMs: number;
  #preconnectCount: number;
  #preconnectIdleMs: number;
  #prepared: DataConnection[] = [];
  #preconnectHits = 0;
  #stopped = true;

  constructor(options: EgressRuntimeOptions) {
    this.#listen = options.listen;
    this.#relayEndpoint = options.relayEndpoint;
    this.#relayUseTls = options.relayUseTls;
    this.#tunnelServerId = options.tunnelServerId;
    this.#tunnelPublicKeyB64 = options.tunnelPublicKeyB64;
    this.#routeId = options.routeId;
    this.#routeSecret = options.routeSecret;
    this.#access = options.access;
    this.#onMetrics = options.onMetrics;
    this.#readyTimeoutMs = options.readyTimeoutMs ?? 8_000;
    this.#preconnectCount = options.preconnectCount ?? 2;
    this.#preconnectIdleMs = options.preconnectIdleMs ?? 30_000;

    this.#server = createServer((req, res) => {
      void this.#handleRequest(req, res);
    });
    this.#server.maxConnections = 256;
    this.#server.headersTimeout = 10_000;
    this.#server.requestTimeout = 0; // Uploads may legitimately be long-lived.
    this.#server.on("connect", (_request, socket) =>
      rejectUnsupportedProtocol(socket),
    );
    this.#server.on("upgrade", (_request, socket) =>
      rejectUnsupportedProtocol(socket),
    );
  }

  async start(): Promise<void> {
    this.#server.listen(this.#listen.port, this.#listen.host);
    try {
      await once(this.#server, "listening");
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "EADDRINUSE"
      ) {
        throw new Error(
          `Port ${this.#listen.port} is already in use. Choose another port.`,
        );
      }
      throw new Error(
        "Cannot open the listener. Check its address and port permissions.",
      );
    }
    const addr = this.#server.address();
    if (addr && typeof addr !== "string") {
      this.#actualPort = addr.port;
    }
    this.#stopped = false;
    this.#prepareConnections();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#prepared = [];
    for (const conn of this.#dataConnections.values()) {
      conn.fail();
    }
    this.#dataConnections.clear();
    await new Promise<void>((resolve) => {
      this.#server.close(() => resolve());
      this.#server.closeAllConnections();
    });
  }

  getActualPort(): number {
    return this.#actualPort;
  }

  getMetrics(): EgressMetrics {
    return {
      activeDataConnections: this.#dataConnections.size,
      totalDataConnections: this.#totalDataConnections,
      preparedConnections: this.#prepared.filter((conn) =>
        conn.channel?.isOpen(),
      ).length,
      preconnectHits: this.#preconnectHits,
    };
  }

  async #handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // Reject CONNECT
    if (req.method === "CONNECT") {
      res.writeHead(400);
      res.end("CONNECT not allowed");
      return;
    }

    // Reject Upgrade
    const upgrade = req.headers.upgrade;
    if (upgrade && upgrade.trim().length > 0) {
      res.writeHead(400);
      res.end("Upgrade not allowed");
      return;
    }

    // Validate access token
    if (this.#access.mode !== "none") {
      let providedToken: string | string[] | null | undefined;
      if (this.#access.mode === "header") {
        providedToken = req.headers["x-paseo-access-token"];
      } else {
        providedToken = this.#extractBearerToken(req.headers.authorization);
      }

      if (!providedToken || typeof providedToken !== "string") {
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }

      const providedHash = createHash("sha256")
        .update(providedToken)
        .digest("hex");
      const expectedHash = this.#access.tokenHash ?? "";

      if (
        providedHash.length !== expectedHash.length ||
        !timingSafeEqual(Buffer.from(providedHash), Buffer.from(expectedHash))
      ) {
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }
    }

    if (
      this.#stopped ||
      (this.#dataConnections.size >= 128 && this.#prepared.length === 0)
    ) {
      res.writeHead(503, { Connection: "close" });
      res.end("Tunnel capacity reached");
      return;
    }

    const ready = this.#prepared.findIndex((conn) => conn.channel?.isOpen());
    const conn =
      this.#prepared.splice(Math.max(ready, 0), 1)[0] ??
      this.#createConnection();
    if (conn.channel?.isOpen()) this.#preconnectHits++;
    if (conn.idleTimeout) clearTimeout(conn.idleTimeout);
    conn.idleTimeout = null;
    conn.request = { req, res };
    req.pause();
    req.once("aborted", conn.fail);
    res.once("close", () => conn.ws.terminate());
    this.#startPreparedRequest(conn);
    this.#prepareConnections();
  }

  // Each prepared channel is leased once. No HTTP request, token or body is cached.
  // Expired/failed idle channels are replenished only by subsequent authenticated traffic.
  #prepareConnections(): void {
    while (
      !this.#stopped &&
      this.#prepared.length < this.#preconnectCount &&
      this.#dataConnections.size < 128
    ) {
      this.#prepared.push(this.#createConnection());
    }
  }

  #startPreparedRequest(conn: DataConnection): void {
    if (
      conn.finished ||
      conn.started ||
      !conn.request ||
      !conn.channel?.isOpen()
    )
      return;
    conn.started = true;
    void this.#handleE2EEOpen(conn.id, conn.request.req).catch(conn.fail);
  }

  #createConnection(): DataConnection {
    const connectionId = `tunnel-${randomUUID()}`;
    const url = this.#buildRelayUrl("client", connectionId);
    const ws = new WebSocket(url, {
      maxPayload: 256 * 1024,
      perMessageDeflate: false,
    });
    this.#totalDataConnections++;

    const conn: DataConnection = {
      id: connectionId,
      ws,
      channel: null,
      requestWindow: new TunnelCreditWindow(),
      responseWindow: new TunnelCreditWindow(),
      pendingRequestAcks: [],
      responseOrder: new TunnelStreamOrder(),
      finished: false,
      readyTimeout: null,
      idleTimeout: null,
      request: null,
      started: false,
      fail: () => failRequest(),
    };
    this.#dataConnections.set(connectionId, conn);
    this.#emitMetrics();

    const cleanup = () => {
      if (conn.readyTimeout) clearTimeout(conn.readyTimeout);
      if (conn.idleTimeout) clearTimeout(conn.idleTimeout);
      this.#prepared = this.#prepared.filter((item) => item !== conn);
      rejectPendingAcknowledgements(conn.pendingRequestAcks);
      if (!this.#dataConnections.delete(connectionId)) return;
      this.#emitMetrics();
    };

    const failRequest = () => {
      if (conn.finished) {
        ws.terminate();
        cleanup();
        return;
      }
      conn.finished = true;
      conn.request?.req.resume();
      rejectPendingAcknowledgements(conn.pendingRequestAcks);
      if (conn.request) sendBadGateway(conn.request.res);
      ws.terminate();
      cleanup();
    };

    conn.readyTimeout = setTimeout(failRequest, this.#readyTimeoutMs);
    conn.idleTimeout = setTimeout(failRequest, this.#preconnectIdleMs);
    conn.idleTimeout.unref();

    ws.once("error", failRequest);

    ws.once("close", () => {
      failRequest();
      cleanup();
    });

    ws.once("open", async () => {
      try {
        conn.channel = await createClientChannel(
          this.#createTransport(ws),
          this.#tunnelPublicKeyB64,
          {
            onopen: () => {
              if (conn.readyTimeout) clearTimeout(conn.readyTimeout);
              this.#startPreparedRequest(conn);
            },
            onmessage: (data) => {
              if (conn.request)
                this.#handleMessage(connectionId, data, conn.request.res);
              else failRequest();
            },
            onclose: failRequest,
            onerror: failRequest,
          },
        );
        this.#startPreparedRequest(conn);
      } catch {
        failRequest();
      }
    });
    return conn;
  }

  async #handleE2EEOpen(
    connectionId: string,
    req: IncomingMessage,
  ): Promise<void> {
    const conn = this.#dataConnections.get(connectionId);
    if (!conn?.channel) return;

    const blockedHeaders = new Set(["host"]);
    if (this.#access.mode === "header")
      blockedHeaders.add("x-paseo-access-token");
    if (this.#access.mode === "bearer") blockedHeaders.add("authorization");
    const headers = sanitizeTunnelHeaders(
      rawHeadersToTuples(req.rawHeaders),
      blockedHeaders,
    );

    // Send request head
    await conn.channel.send(
      encodeTunnelFrame({
        v: 1,
        type: "request.head",
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers,
        routeId: this.#routeId,
        routeSecret: this.#routeSecret,
        client: {
          address: req.socket.remoteAddress ?? null,
          host: req.headers.host ?? null,
          protocol: "http",
        },
      }),
    );

    req.resume();

    let finalAcknowledgement: Promise<void> | null = null;
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk);
      for (let offset = 0; offset < buffer.byteLength; offset += FRAME_BYTES) {
        const frame = buffer.subarray(
          offset,
          Math.min(offset + FRAME_BYTES, buffer.byteLength),
        );
        let resolveAcknowledgement!: () => void;
        let rejectAcknowledgement!: (error: Error) => void;
        const acknowledgement = new Promise<void>((resolve, reject) => {
          resolveAcknowledgement = resolve;
          rejectAcknowledgement = reject;
        });
        // Earlier in-flight acknowledgements can reject before the producer awaits them.
        void acknowledgement.catch(() => undefined);
        conn.pendingRequestAcks.push({
          bytes: frame.byteLength,
          completed: acknowledgement,
          resolve: resolveAcknowledgement,
          reject: rejectAcknowledgement,
        });
        conn.requestWindow.reserve(frame.byteLength);

        await conn.channel.send(
          frame.buffer.slice(
            frame.byteOffset,
            frame.byteOffset + frame.byteLength,
          ),
        );

        if (conn.pendingRequestAcks.length >= FLOW_WINDOW_CHUNKS) {
          await conn.pendingRequestAcks[0].completed;
        }
        finalAcknowledgement = acknowledgement;
      }
    }

    if (finalAcknowledgement) await finalAcknowledgement;
    await conn.channel.send(encodeTunnelFrame({ v: 1, type: "request.end" }));
  }

  #handleMessage(
    connectionId: string,
    data: string | ArrayBuffer,
    res: ServerResponse,
  ): void {
    const conn = this.#dataConnections.get(connectionId);
    if (!conn) return;

    try {
      if (typeof data === "string") {
        const frame = decodeTunnelFrame(data);
        this.#handleControlFrame(connectionId, frame, res);
      } else {
        conn.responseOrder.acceptBody();
        const buffer = Buffer.from(data);
        conn.responseWindow.reserve(buffer.byteLength);

        if (!res.write(buffer)) {
          res.once("drain", () => {
            void conn.channel
              ?.send(
                encodeTunnelFrame({
                  v: 1,
                  type: "response.ack",
                  bytes: buffer.byteLength,
                }),
              )
              .catch(() => conn.ws.terminate());
            conn.responseWindow.acknowledge(buffer.byteLength);
          });
        } else {
          void conn.channel
            ?.send(
              encodeTunnelFrame({
                v: 1,
                type: "response.ack",
                bytes: buffer.byteLength,
              }),
            )
            .catch(() => conn.ws.terminate());
          conn.responseWindow.acknowledge(buffer.byteLength);
        }
      }
    } catch {
      void this.#failInvalidConnection(conn, res);
    }
  }

  #handleControlFrame(
    connectionId: string,
    frame: TunnelFrame,
    res: ServerResponse,
  ): void {
    const conn = this.#dataConnections.get(connectionId);
    if (!conn) return;

    if (frame.type === "response.head") {
      conn.responseOrder.acceptHead();
      const headers = sanitizeTunnelHeaders(frame.headers);
      if (frame.statusMessage) {
        res.writeHead(
          frame.statusCode,
          frame.statusMessage,
          tuplesToRawHeaders(headers),
        );
      } else {
        res.writeHead(frame.statusCode, tuplesToRawHeaders(headers));
      }
      res.flushHeaders();
      return;
    }

    if (frame.type === "response.end") {
      conn.responseOrder.acceptEnd();
      conn.finished = true;
      res.end();
      conn.ws.close(1000, "complete");
      return;
    }

    if (frame.type === "request.ack") {
      const pending = conn.pendingRequestAcks[0];
      if (!pending || pending.bytes !== frame.bytes) {
        throw new Error("Invalid request acknowledgement");
      }
      conn.requestWindow.acknowledge(frame.bytes);
      conn.pendingRequestAcks.shift();
      pending.resolve();
      return;
    }

    if (frame.type === "error") {
      conn.finished = true;
      sendBadGateway(res);
      conn.ws.close(1000, "tunnel error");
      return;
    }

    throw new Error("Unexpected Tunnel frame");
  }

  async #failInvalidConnection(
    conn: DataConnection,
    res: ServerResponse,
  ): Promise<void> {
    if (conn.finished) return;
    conn.finished = true;
    sendBadGateway(res);
    try {
      if (conn.channel?.isOpen()) {
        await conn.channel.send(
          encodeTunnelFrame({ v: 1, type: "error", code: "INVALID_REQUEST" }),
        );
      }
    } catch {
      // The peer may have already disconnected.
    } finally {
      conn.ws.terminate();
    }
  }

  #extractBearerToken(
    authorization: string | string[] | undefined,
  ): string | null {
    const header = Array.isArray(authorization)
      ? authorization[0]
      : authorization;
    if (!header) return null;
    const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
    return match?.[1] ?? null;
  }

  #buildRelayUrl(role: "client" | "server", connectionId?: string): string {
    return buildTunnelRelayUrl({
      endpoint: this.#relayEndpoint,
      useTls: this.#relayUseTls,
      serverId: this.#tunnelServerId,
      role,
      connectionId,
    });
  }

  #createTransport(ws: WebSocket) {
    const transport = {
      send: async (data: string | ArrayBuffer) => {
        await new Promise<void>((resolve, reject) => {
          ws.send(data, (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      },
      close: (code?: number, reason?: string) => ws.close(code, reason),
      onmessage: null as
        | ((message: { data: string | ArrayBuffer; isBinary: boolean }) => void)
        | null,
      onclose: null as ((code: number, reason: string) => void) | null,
      onerror: null as ((error: Error) => void) | null,
    };

    ws.on("message", (raw, isBinary) => {
      const data = isBinary
        ? rawToArrayBuffer(raw)
        : Buffer.from(raw as Buffer).toString("utf8");
      transport.onmessage?.({ data, isBinary });
    });

    ws.on("close", (code, reason) => {
      transport.onclose?.(code, reason.toString());
    });

    ws.on("error", (error) => {
      transport.onerror?.(error);
    });

    return transport;
  }

  #emitMetrics(): void {
    this.#onMetrics?.(this.getMetrics());
  }
}

function rejectPendingAcknowledgements(
  pending: PendingAcknowledgement[],
): void {
  const error = new Error("Tunnel connection closed");
  for (const acknowledgement of pending.splice(0))
    acknowledgement.reject(error);
}

function rejectUnsupportedProtocol(socket: import("node:stream").Duplex): void {
  socket.end(
    "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 23\r\nConnection: close\r\n\r\nUnsupported HTTP method",
  );
}

function rawToArrayBuffer(data: RawData): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data.slice(0);
  const buffer = Array.isArray(data)
    ? Buffer.concat(data)
    : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}

function sendBadGateway(res: ServerResponse): void {
  if (res.writableEnded || res.destroyed) return;
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(502);
  res.end("Tunnel request failed");
}
