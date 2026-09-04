import { request } from "node:http";
import { performance } from "node:perf_hooks";
import type { TunnelEgressState } from "../shared/tunnel-types.shared.js";
import {
  RequestOptionsSchema,
  requestHeaders,
  type RequestOptions,
  type ProbeResult,
} from "../shared/request.shared.js";

// Probe the installed listener, never a user-provided external URL. Do not follow redirects.
export function probeEgress(
  entry: TunnelEgressState,
  options: RequestOptions,
): Promise<ProbeResult> {
  RequestOptionsSchema.parse(options);
  if (!entry.enabled)
    return Promise.resolve({
      status: null,
      elapsedMs: 0,
      contentType: "",
      preview: "",
      truncated: false,
      error: "disabled",
    });
  // Do not send credentials to another process occupying a failed listener's port.
  if (entry.status !== "listening")
    return Promise.resolve({
      status: null,
      elapsedMs: 0,
      contentType: "",
      preview: "",
      truncated: false,
      error: "connection",
    });
  const start = performance.now();
  return new Promise((resolve) => {
    let finished = false;
    let status: number | null = null;
    let contentType = "";
    const chunks: Buffer[] = [];
    let bytes = 0;
    const redact = (value: string) =>
      [options.token, options.bearerToken]
        .filter(Boolean)
        .reduce((text, token) => text.replaceAll(token, "[REDACTED]"), value);
    const finish = (error: ProbeResult["error"], truncated = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        status,
        elapsedMs: Math.round(performance.now() - start),
        contentType: redact(contentType),
        preview: redact(Buffer.concat(chunks).toString("utf8")),
        truncated,
        error,
      });
      req.destroy();
    };
    const req = request(
      {
        hostname: "127.0.0.1",
        port: entry.listen.port,
        path: options.path,
        method: options.method,
        headers: requestHeaders(entry.access.mode, options),
      },
      (response) => {
        status = response.statusCode ?? null;
        contentType = response.headers["content-type"] ?? "";
        response.on("data", (chunk: Buffer) => {
          const remaining = 8192 - bytes;
          chunks.push(chunk.subarray(0, remaining));
          bytes += Math.min(chunk.length, remaining);
          if (bytes >= 8192 || contentType.includes("text/event-stream"))
            finish(null, true);
        });
        response.once("end", () => finish(null));
        response.once("error", () => finish("connection", bytes > 0));
      },
    );
    const timer = setTimeout(() => finish("timeout", status !== null), 10000);
    req.once("error", () => finish("connection"));
    req.end(options.method === "POST" ? options.body : undefined);
  });
}
