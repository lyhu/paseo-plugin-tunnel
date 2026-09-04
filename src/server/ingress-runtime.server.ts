/**
 * Ingress runtime: maintains Tunnel relay control connection and handles
 * per-request data connections from Egress.
 */

import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { WebSocket, type RawData } from "ws";
import {
  createDaemonChannel,
  type KeyPair,
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
  type TunnelErrorCode,
} from "./tunnel-wire.server.js";
import {
  rawHeadersToTuples,
  sanitizeTunnelHeaders,
  tuplesToRawHeaders,
} from "./http-headers.server.js";
import { timingSafeEqual } from "node:crypto";
import { buildTunnelRelayUrl } from "./relay-url.server.js";

interface IngressRoute {
  routeId: string;
  routeSecret: string;
  targetOrigin: string;
}

export interface IngressRuntimeOptions {
  relayEndpoint: string;
  relayUseTls: boolean;
  tunnelServerId: string;
  tunnelKeyPair: KeyPair;
  routes: IngressRoute[];
  onMetrics?: (metrics: IngressMetrics) => void;
  onStatus?: (status: IngressRuntimeStatus) => void;
  reconnectDelayMs?: number;
  readyTimeoutMs?: number;
}

export type IngressRuntimeStatus = "connecting" | "ready" | "error";

type IngressControlMessage =
  | { type: "sync"; connectionIds: string[] }
  | { type: "connected"; connectionId: string };

export interface IngressMetrics {
  activeDataConnections: number;
  totalDataConnections: number;
}

interface PendingAcknowledgement {
  bytes: number;
  resolve: () => void;
  reject: (error: Error) => void;
}

interface DataConnection {
  ws: WebSocket;
  channel: EncryptedChannel | null;
  upstream: ReturnType<typeof httpRequest> | null;
  upstreamResponse: IncomingMessage | null;
  requestWindow: TunnelCreditWindow;
  responseWindow: TunnelCreditWindow;
  pendingResponseAcks: PendingAcknowledgement[];
  requestOrder: TunnelStreamOrder;
  routeId: string | null;
}

export class IngressRuntime {
  #relayEndpoint: string;
  #relayUseTls: boolean;
  #tunnelServerId: string;
  #tunnelKeyPair: KeyPair;
  #routes: Map<string, IngressRoute>;
  #controlWs: WebSocket | null = null;
  #dataConnections = new Map<string, DataConnection>();
  #stopped = false;
  #onMetrics?: (metrics: IngressMetrics) => void;
  #onStatus?: (status: IngressRuntimeStatus) => void;
  #totalDataConnections = 0;
  #status: IngressRuntimeStatus = "error";
  #reconnectDelayMs: number;
  #readyTimeoutMs: number;
  #reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  #controlReadyTimeout: ReturnType<typeof setTimeout> | null = null;
  #controlKeepaliveInterval: ReturnType<typeof setInterval> | null = null;
  #controlLastSeenAt = 0;
  #cancelControlReady: (() => void) | null = null;

  constructor(options: IngressRuntimeOptions) {
    this.#relayEndpoint = options.relayEndpoint;
    this.#relayUseTls = options.relayUseTls;
    this.#tunnelServerId = options.tunnelServerId;
    this.#tunnelKeyPair = options.tunnelKeyPair;
    this.#routes = new Map(options.routes.map((r) => [r.routeId, r]));
    this.#onMetrics = options.onMetrics;
    this.#onStatus = options.onStatus;
    this.#reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
    this.#readyTimeoutMs = options.readyTimeoutMs ?? 8_000;
  }

  async start(): Promise<void> {
    this.#stopped = false;
    await this.#connectControl();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#cancelControlReady?.();
    this.#cancelControlReady = null;
    if (this.#reconnectTimeout) clearTimeout(this.#reconnectTimeout);
    this.#reconnectTimeout = null;
    this.#clearControlTimers();
    this.#controlWs?.terminate();
    this.#controlWs = null;
    for (const conn of this.#dataConnections.values()) {
      conn.upstream?.destroy();
      conn.upstreamResponse?.destroy();
      conn.ws.terminate();
    }
    this.#dataConnections.clear();
  }

  updateRoutes(routes: IngressRoute[]): void {
    const next = new Map(routes.map((route) => [route.routeId, route]));
    for (const conn of this.#dataConnections.values()) {
      if (!conn.routeId) continue;
      const previous = this.#routes.get(conn.routeId);
      const replacement = next.get(conn.routeId);
      if (
        !replacement ||
        previous?.routeSecret !== replacement.routeSecret ||
        previous?.targetOrigin !== replacement.targetOrigin
      ) {
        conn.upstream?.destroy();
        conn.upstreamResponse?.destroy();
        conn.ws.terminate();
      }
    }
    this.#routes = next;
  }

  getMetrics(): IngressMetrics {
    return {
      activeDataConnections: this.#dataConnections.size,
      totalDataConnections: this.#totalDataConnections,
    };
  }

  getStatus(): IngressRuntimeStatus {
    return this.#status;
  }

  async #connectControl(): Promise<void> {
    if (this.#stopped) return;
    this.#setStatus("connecting");
    const url = this.#buildRelayUrl("server");
    const ws = new WebSocket(url, {
      handshakeTimeout: this.#readyTimeoutMs,
      maxPayload: 256 * 1024,
      perMessageDeflate: false,
    });
    this.#controlWs = ws;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const resolveReady = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const rejectReady = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      this.#cancelControlReady = () => rejectReady(new Error("Tunnel stopped"));

      ws.once("open", () => {
        if (this.#controlWs !== ws) return;
        this.#controlLastSeenAt = Date.now();
        this.#controlReadyTimeout = setTimeout(() => {
          if (this.#controlWs !== ws || this.#status === "ready") return;
          this.#setStatus("error");
          rejectReady(new Error("Tunnel relay ready timeout"));
          ws.terminate();
        }, this.#readyTimeoutMs);
        this.#controlKeepaliveInterval = setInterval(() => {
          if (this.#controlWs !== ws || ws.readyState !== WebSocket.OPEN)
            return;
          if (Date.now() - this.#controlLastSeenAt > this.#readyTimeoutMs * 3) {
            ws.terminate();
            return;
          }
          ws.ping();
        }, this.#readyTimeoutMs);
        ws.ping();
      });

      ws.on("message", (raw) => {
        if (this.#controlWs !== ws) return;
        this.#controlLastSeenAt = Date.now();
        const message = parseControlMessage(raw);
        if (!message) return;

        if (this.#status !== "ready") {
          this.#setStatus("ready");
          if (this.#controlReadyTimeout)
            clearTimeout(this.#controlReadyTimeout);
          this.#controlReadyTimeout = null;
          resolveReady();
        }

        const ids =
          message.type === "sync"
            ? message.connectionIds
            : [message.connectionId];
        for (const connectionId of ids) {
          if (connectionId && !this.#dataConnections.has(connectionId)) {
            void this.#handleDataConnection(connectionId);
          }
        }
      });

      ws.on("pong", () => {
        if (this.#controlWs === ws) this.#controlLastSeenAt = Date.now();
      });

      ws.once("error", (error) => {
        if (this.#controlWs !== ws) return;
        this.#setStatus("error");
        rejectReady(error);
      });

      ws.once("close", () => {
        if (this.#controlWs !== ws) return;
        this.#controlWs = null;
        this.#clearControlTimers();
        if (this.#stopped) return;
        this.#setStatus("connecting");
        rejectReady(new Error("Tunnel relay disconnected before ready"));
        this.#scheduleReconnect();
      });
    });
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#reconnectTimeout) return;
    this.#reconnectTimeout = setTimeout(() => {
      this.#reconnectTimeout = null;
      void this.#connectControl().catch(() => undefined);
    }, this.#reconnectDelayMs);
  }

  #clearControlTimers(): void {
    if (this.#controlReadyTimeout) clearTimeout(this.#controlReadyTimeout);
    if (this.#controlKeepaliveInterval)
      clearInterval(this.#controlKeepaliveInterval);
    this.#controlReadyTimeout = null;
    this.#controlKeepaliveInterval = null;
  }

  #setStatus(status: IngressRuntimeStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    this.#onStatus?.(status);
  }

  async #handleDataConnection(connectionId: string): Promise<void> {
    if (this.#stopped || this.#dataConnections.size >= 128) return;

    const url = this.#buildRelayUrl("server", connectionId);
    const ws = new WebSocket(url, {
      maxPayload: 256 * 1024,
      perMessageDeflate: false,
    });
    this.#totalDataConnections++;

    const conn: DataConnection = {
      ws,
      channel: null,
      upstream: null,
      upstreamResponse: null,
      requestWindow: new TunnelCreditWindow(),
      responseWindow: new TunnelCreditWindow(),
      pendingResponseAcks: [],
      requestOrder: new TunnelStreamOrder(),
      routeId: null,
    };
    this.#dataConnections.set(connectionId, conn);
    this.#emitMetrics();

    const cleanup = () => {
      conn.upstream?.destroy();
      conn.upstreamResponse?.destroy();
      rejectPendingAcknowledgements(conn.pendingResponseAcks);
      if (!this.#dataConnections.delete(connectionId)) return;
      this.#emitMetrics();
    };

    ws.once("close", cleanup);
    ws.once("error", cleanup);

    ws.once("open", async () => {
      try {
        conn.channel = await createDaemonChannel(
          this.#createTransport(ws),
          this.#tunnelKeyPair,
          {
            onmessage: (data) => this.#handleMessage(connectionId, data),
            onerror: () => ws.close(1011, "E2EE error"),
          },
        );
      } catch {
        ws.close(1011, "handshake failed");
      }
    });
  }

  #handleMessage(connectionId: string, data: string | ArrayBuffer): void {
    const conn = this.#dataConnections.get(connectionId);
    if (!conn) return;

    try {
      if (typeof data === "string") {
        const frame = decodeTunnelFrame(data);
        this.#handleControlFrame(connectionId, frame);
      } else {
        conn.requestOrder.acceptBody();
        if (!conn.upstream) throw new Error("Missing upstream request");
        const buffer = Buffer.from(data);
        conn.requestWindow.reserve(buffer.byteLength);

        if (!conn.upstream.write(buffer)) {
          conn.upstream.once("drain", () => {
            void conn.channel
              ?.send(
                encodeTunnelFrame({
                  v: 1,
                  type: "request.ack",
                  bytes: buffer.byteLength,
                }),
              )
              .catch(() => conn.ws.terminate());
            conn.requestWindow.acknowledge(buffer.byteLength);
          });
        } else {
          void conn.channel
            ?.send(
              encodeTunnelFrame({
                v: 1,
                type: "request.ack",
                bytes: buffer.byteLength,
              }),
            )
            .catch(() => conn.ws.terminate());
          conn.requestWindow.acknowledge(buffer.byteLength);
        }
      }
    } catch {
      void this.#failConnection(conn, "INVALID_REQUEST");
    }
  }

  #handleControlFrame(connectionId: string, frame: TunnelFrame): void {
    const conn = this.#dataConnections.get(connectionId);
    if (!conn) return;

    if (frame.type === "request.head") {
      conn.requestOrder.acceptHead();
      // Validate route
      const route = this.#routes.get(frame.routeId);
      if (!route) {
        void this.#failConnection(conn, "ROUTE_NOT_FOUND");
        return;
      }

      // Timing-safe route secret comparison
      const providedSecret = Buffer.from(frame.routeSecret, "utf8");
      const expectedSecret = Buffer.from(route.routeSecret, "utf8");
      if (
        providedSecret.length !== expectedSecret.length ||
        !timingSafeEqual(providedSecret, expectedSecret)
      ) {
        void this.#failConnection(conn, "ROUTE_UNAUTHORIZED");
        return;
      }

      conn.routeId = frame.routeId;

      // Reject CONNECT and Upgrade
      if (frame.method === "CONNECT") {
        void this.#failConnection(conn, "INVALID_REQUEST");
        return;
      }

      const hasUpgrade = frame.headers.some(
        ([name, value]) =>
          name.toLowerCase() === "upgrade" && value.trim().length > 0,
      );
      if (hasUpgrade) {
        void this.#failConnection(conn, "INVALID_REQUEST");
        return;
      }

      // Build upstream request
      const origin = new URL(route.targetOrigin);
      const blockedHeaders = new Set([
        "host",
        "x-forwarded-for",
        "x-forwarded-host",
        "x-forwarded-proto",
      ]);
      const headers = sanitizeTunnelHeaders(frame.headers, blockedHeaders);
      headers.unshift(["host", origin.host]);
      if (frame.client.address)
        headers.push(["x-forwarded-for", frame.client.address]);
      if (frame.client.host)
        headers.push(["x-forwarded-host", frame.client.host]);
      headers.push(["x-forwarded-proto", frame.client.protocol]);

      const createUpstreamRequest =
        origin.protocol === "https:" ? httpsRequest : httpRequest;
      conn.upstream = createUpstreamRequest(
        {
          protocol: origin.protocol,
          hostname: origin.hostname.replace(/^\[|\]$/g, ""),
          port: origin.port || undefined,
          method: frame.method,
          path: frame.path,
          headers: tuplesToRawHeaders(headers),
        },
        (response) => {
          conn.upstreamResponse = response;
          void this.#handleUpstreamResponse(connectionId).catch(() => {
            if (conn.ws.readyState === WebSocket.OPEN)
              conn.ws.close(1011, "upstream response failed");
          });
        },
      );
      conn.upstream.on("error", () => {
        void this.#failConnection(conn, "UPSTREAM_UNAVAILABLE");
      });
      return;
    }

    if (frame.type === "request.end") {
      conn.requestOrder.acceptEnd();
      if (!conn.upstream) throw new Error("Missing upstream request");
      conn.upstream.end();
      return;
    }

    if (frame.type === "response.ack") {
      const pending = conn.pendingResponseAcks[0];
      if (!pending || pending.bytes !== frame.bytes) {
        throw new Error("Invalid response acknowledgement");
      }
      conn.responseWindow.acknowledge(frame.bytes);
      conn.pendingResponseAcks.shift();
      pending.resolve();
      return;
    }

    if (frame.type === "error") {
      conn.ws.close(1000, "tunnel error");
      return;
    }

    throw new Error("Unexpected Tunnel frame");
  }

  async #handleUpstreamResponse(connectionId: string): Promise<void> {
    const conn = this.#dataConnections.get(connectionId);
    if (!conn?.upstreamResponse || !conn.channel) return;

    const response = conn.upstreamResponse;
    const headers = sanitizeTunnelHeaders(
      rawHeadersToTuples(response.rawHeaders),
    );

    await conn.channel.send(
      encodeTunnelFrame({
        v: 1,
        type: "response.head",
        statusCode: response.statusCode ?? 502,
        statusMessage: response.statusMessage,
        headers,
      }),
    );
    let finalAcknowledgement: Promise<void> | null = null;
    for await (const chunk of response) {
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
        conn.pendingResponseAcks.push({
          bytes: frame.byteLength,
          resolve: resolveAcknowledgement,
          reject: rejectAcknowledgement,
        });
        conn.responseWindow.reserve(frame.byteLength);

        await conn.channel.send(
          frame.buffer.slice(
            frame.byteOffset,
            frame.byteOffset + frame.byteLength,
          ),
        );

        if (conn.pendingResponseAcks.length >= FLOW_WINDOW_CHUNKS) {
          await acknowledgement;
        }
        finalAcknowledgement = acknowledgement;
      }
    }

    if (finalAcknowledgement) await finalAcknowledgement;
    await conn.channel.send(encodeTunnelFrame({ v: 1, type: "response.end" }));
    // response.end was flushed by send(); release the socket without waiting
    // for a Relay close handshake (Durable Objects can delay it by 30 seconds).
    conn.ws.terminate();
  }

  async #failConnection(
    conn: DataConnection,
    code: TunnelErrorCode,
  ): Promise<void> {
    try {
      const channel = conn.channel;
      if (conn.ws.readyState === WebSocket.OPEN && channel?.isOpen()) {
        await channel.send(encodeTunnelFrame({ v: 1, type: "error", code }));
      }
    } catch {
      // The peer can close after the readyState check while the error frame is in flight.
    } finally {
      if (
        conn.ws.readyState === WebSocket.OPEN ||
        conn.ws.readyState === WebSocket.CONNECTING
      ) {
        conn.ws.close(1000, "tunnel error");
      }
    }
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

function rawToArrayBuffer(data: RawData): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data.slice(0);
  const buffer = Array.isArray(data)
    ? Buffer.concat(data)
    : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return copy.buffer;
}

function parseControlMessage(raw: RawData): IngressControlMessage | null {
  try {
    const text =
      typeof raw === "string"
        ? raw
        : Buffer.from(raw as Buffer).toString("utf8");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed.type === "sync" && Array.isArray(parsed.connectionIds)) {
      const connectionIds = parsed.connectionIds.filter(
        (connectionId): connectionId is string =>
          typeof connectionId === "string",
      );
      return { type: "sync", connectionIds };
    }
    if (
      parsed.type === "connected" &&
      typeof parsed.connectionId === "string"
    ) {
      return { type: "connected", connectionId: parsed.connectionId };
    }
    return null;
  } catch {
    return null;
  }
}
