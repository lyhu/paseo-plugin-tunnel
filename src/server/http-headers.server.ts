import type { TunnelHeader } from "./tunnel-wire.server.js";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function rawHeadersToTuples(rawHeaders: string[]): TunnelHeader[] {
  const headers: TunnelHeader[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    headers.push([rawHeaders[index] ?? "", rawHeaders[index + 1] ?? ""]);
  }
  return headers;
}

export function sanitizeTunnelHeaders(
  headers: TunnelHeader[],
  blockedHeaders: ReadonlySet<string> = new Set(),
): TunnelHeader[] {
  const connectionHeaders = new Set<string>();
  for (const [name, value] of headers) {
    if (name.toLowerCase() !== "connection") continue;
    for (const item of value.split(","))
      connectionHeaders.add(item.trim().toLowerCase());
  }

  return headers.filter(([name]) => {
    const normalized = name.toLowerCase();
    return (
      !HOP_BY_HOP_HEADERS.has(normalized) &&
      !connectionHeaders.has(normalized) &&
      !blockedHeaders.has(normalized)
    );
  });
}

export function tuplesToRawHeaders(headers: TunnelHeader[]): string[] {
  return headers.flat();
}
