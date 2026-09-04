import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { WebSocket } from "ws";
import {
  createClientChannel,
  type EncryptedChannel,
} from "@getpaseo/relay/e2ee";
import { buildTunnelRelayUrl } from "./relay-url.server.js";
import { decodeTunnelFrame, encodeTunnelFrame } from "./tunnel-wire.server.js";
import type { RouteOffer } from "./config.server.js";

const TIMEOUT_MS = 8000;

// A response proves HTTP reachability, including an API's 401/404/5xx responses.
// No caller credentials or response body are needed for this transport check.
export function checkOrigin(
  origin: string,
  signal: AbortSignal,
): Promise<number | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = new URL(origin);
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      { method: "HEAD", signal },
      (response) => finish(response.statusCode ?? null),
    );
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    let done = false;
    function finish(status: number | null) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(status);
      req.destroy();
    }
    req.once("error", () => finish(null));
    req.end();
  });
}

export function checkOffer(
  offer: RouteOffer,
  signal: AbortSignal,
): Promise<number | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const ws = new WebSocket(
      buildTunnelRelayUrl({
        endpoint: offer.relayEndpoint,
        useTls: offer.relayUseTls,
        serverId: offer.tunnelServerId,
        role: "client",
      }),
      { maxPayload: 256 * 1024, perMessageDeflate: false },
    );
    let done = false;
    let channel: EncryptedChannel | null = null;
    const timer = setTimeout(() => finish(null), TIMEOUT_MS);
    const abort = () => finish(null);
    signal.addEventListener("abort", abort, { once: true });
    function finish(status: number | null) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      resolve(status);
      ws.terminate();
    }
    const transport = {
      send: (data: string | ArrayBuffer) =>
        new Promise<void>((resolve, reject) =>
          ws.send(data, (error) => (error ? reject(error) : resolve())),
        ),
      close: (code?: number, reason?: string) => ws.close(code, reason),
      onmessage: null as
        | ((message: { data: string | ArrayBuffer; isBinary: boolean }) => void)
        | null,
      onclose: null as ((code: number, reason: string) => void) | null,
      onerror: null as ((error: Error) => void) | null,
    };
    ws.on("message", (raw, isBinary) => {
      const bytes = Array.isArray(raw)
        ? Buffer.concat(raw)
        : Buffer.from(raw as ArrayBuffer);
      transport.onmessage?.({
        data: isBinary ? Uint8Array.from(bytes).buffer : bytes.toString("utf8"),
        isBinary,
      });
    });
    ws.once("error", (error) => {
      finish(null);
      transport.onerror?.(error);
    });
    ws.once("close", (code, reason) => {
      finish(null);
      transport.onclose?.(code, reason.toString());
    });
    ws.once("open", () => {
      void createClientChannel(transport, offer.tunnelPublicKeyB64, {
        onopen: () => {
          void sendHead().catch(() => finish(null));
        },
        onmessage: (data) => {
          try {
            if (typeof data !== "string") {
              finish(null);
              return;
            }
            const frame = decodeTunnelFrame(data);
            if (frame.type === "response.head") finish(frame.statusCode);
            else if (frame.type === "error") finish(null);
          } catch {
            finish(null);
          }
        },
        onclose: () => finish(null),
        onerror: () => finish(null),
      })
        .then((value) => {
          channel = value;
          if (done) ws.terminate();
        })
        .catch(() => finish(null));
    });
    async function sendHead() {
      if (done || !channel) return;
      await channel.send(
        encodeTunnelFrame({
          v: 1,
          type: "request.head",
          routeId: offer.routeId,
          routeSecret: offer.routeSecret,
          method: "HEAD",
          path: "/",
          headers: [],
          client: { address: null, host: null, protocol: "http" },
        }),
      );
      if (!done)
        await channel.send(encodeTunnelFrame({ v: 1, type: "request.end" }));
    }
  });
}
