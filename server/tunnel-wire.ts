export const FRAME_BYTES = 64 * 1024;
export const FLOW_WINDOW_CHUNKS = 8;
export const FLOW_WINDOW_BYTES = FRAME_BYTES * FLOW_WINDOW_CHUNKS;

export type TunnelHeader = [name: string, value: string];

export interface TunnelClient {
  address: string | null;
  host: string | null;
  protocol: "http";
}

export const TUNNEL_ERROR_CODES = [
  "INVALID_REQUEST",
  "ROUTE_NOT_FOUND",
  "ROUTE_UNAUTHORIZED",
  "UPSTREAM_UNAVAILABLE",
  "UPSTREAM_TLS_ERROR",
  "INTERNAL_ERROR",
] as const;

export type TunnelErrorCode = (typeof TUNNEL_ERROR_CODES)[number];

export type TunnelFrame =
  | {
      v: 1;
      type: "request.head";
      method: string;
      path: string;
      headers: TunnelHeader[];
      routeId: string;
      routeSecret: string;
      client: TunnelClient;
    }
  | { v: 1; type: "request.end" }
  | { v: 1; type: "request.ack"; bytes: number }
  | {
      v: 1;
      type: "response.head";
      statusCode: number;
      statusMessage?: string;
      headers: TunnelHeader[];
    }
  | { v: 1; type: "response.end" }
  | { v: 1; type: "response.ack"; bytes: number }
  | { v: 1; type: "error"; code: TunnelErrorCode };

export function encodeTunnelFrame(frame: TunnelFrame): string {
  return JSON.stringify(frame);
}

export function decodeTunnelFrame(raw: string): TunnelFrame {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Invalid Tunnel frame");
  }
  if (!isRecord(value) || value.v !== 1 || typeof value.type !== "string") {
    throw new Error("Invalid Tunnel frame");
  }

  switch (value.type) {
    case "request.head":
      return decodeRequestHead(value);
    case "response.head":
      return decodeResponseHead(value);
    case "request.ack":
    case "response.ack":
      if (isChunkByteLength(value.bytes))
        return { v: 1, type: value.type, bytes: value.bytes };
      break;
    case "request.end":
    case "response.end":
      return { v: 1, type: value.type };
    case "error":
      if (isTunnelErrorCode(value.code))
        return { v: 1, type: value.type, code: value.code };
      break;
  }
  throw new Error("Invalid Tunnel frame");
}

function decodeRequestHead(value: Record<string, unknown>): TunnelFrame {
  if (typeof value.method !== "string") throw new Error("Invalid Tunnel frame");
  if (!isOriginFormPath(value.path)) throw new Error("Invalid Tunnel frame");
  if (!isHeaders(value.headers)) throw new Error("Invalid Tunnel frame");
  if (typeof value.routeId !== "string")
    throw new Error("Invalid Tunnel frame");
  if (typeof value.routeSecret !== "string")
    throw new Error("Invalid Tunnel frame");
  if (!isTunnelClient(value.client)) throw new Error("Invalid Tunnel frame");

  return {
    v: 1,
    type: "request.head",
    method: value.method,
    path: value.path,
    headers: value.headers,
    routeId: value.routeId,
    routeSecret: value.routeSecret,
    client: value.client,
  };
}

function decodeResponseHead(value: Record<string, unknown>): TunnelFrame {
  if (typeof value.statusCode !== "number")
    throw new Error("Invalid Tunnel frame");
  if (!Number.isInteger(value.statusCode))
    throw new Error("Invalid Tunnel frame");
  if (
    value.statusMessage !== undefined &&
    typeof value.statusMessage !== "string"
  ) {
    throw new Error("Invalid Tunnel frame");
  }
  if (!isHeaders(value.headers)) throw new Error("Invalid Tunnel frame");

  const frame: Extract<TunnelFrame, { type: "response.head" }> = {
    v: 1,
    type: "response.head",
    statusCode: value.statusCode,
    headers: value.headers,
  };
  if (typeof value.statusMessage === "string")
    frame.statusMessage = value.statusMessage;
  return frame;
}

export class TunnelCreditWindow {
  #usedBytes = 0;
  #outstandingChunks: number[] = [];

  get usedBytes(): number {
    return this.#usedBytes;
  }

  reserve(bytes: number): void {
    assertChunkByteLength(bytes);
    if (
      this.#outstandingChunks.length >= FLOW_WINDOW_CHUNKS ||
      this.#usedBytes + bytes > FLOW_WINDOW_BYTES
    ) {
      throw new Error("Tunnel credit window exhausted");
    }
    this.#usedBytes += bytes;
    this.#outstandingChunks.push(bytes);
  }

  acknowledge(bytes: number): void {
    assertChunkByteLength(bytes);
    const oldest = this.#outstandingChunks[0];
    if (oldest === undefined)
      throw new Error("Tunnel acknowledgement has no outstanding chunk");
    if (bytes !== oldest) {
      throw new Error(
        "Tunnel acknowledgement does not match oldest outstanding chunk",
      );
    }
    this.#outstandingChunks.shift();
    this.#usedBytes -= bytes;
  }
}

export class TunnelStreamOrder {
  #phase: "waiting-head" | "body" | "ended" = "waiting-head";

  acceptHead(): void {
    if (this.#phase !== "waiting-head")
      throw new Error("Tunnel stream has duplicate head");
    this.#phase = "body";
  }

  acceptBody(): void {
    if (this.#phase === "waiting-head")
      throw new Error("Tunnel stream has body before head");
    if (this.#phase === "ended")
      throw new Error("Tunnel stream has body after end");
  }

  acceptEnd(): void {
    if (this.#phase === "waiting-head")
      throw new Error("Tunnel stream has end before head");
    if (this.#phase === "ended")
      throw new Error("Tunnel stream has duplicate end");
    this.#phase = "ended";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHeaders(value: unknown): value is TunnelHeader[] {
  return (
    Array.isArray(value) &&
    value.every(
      (header): header is TunnelHeader =>
        Array.isArray(header) &&
        header.length === 2 &&
        typeof header[0] === "string" &&
        typeof header[1] === "string",
    )
  );
}

function isTunnelClient(value: unknown): value is TunnelClient {
  return (
    isRecord(value) &&
    (typeof value.address === "string" || value.address === null) &&
    (typeof value.host === "string" || value.host === null) &&
    value.protocol === "http"
  );
}

function isChunkByteLength(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= FRAME_BYTES
  );
}

function isOriginFormPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
  );
}

function isTunnelErrorCode(value: unknown): value is TunnelErrorCode {
  return (
    typeof value === "string" &&
    TUNNEL_ERROR_CODES.some((code) => code === value)
  );
}

function assertChunkByteLength(bytes: number): void {
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > FRAME_BYTES) {
    throw new Error(`Tunnel chunk exceeds ${FRAME_BYTES} byte limit`);
  }
}
