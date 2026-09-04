import { createServer, type Server, type RequestListener } from "node:http";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";
import {
  buildCurl,
  RequestOptionsSchema,
  requestHeaders,
  type RequestOptions,
} from "../shared/request.shared";
import { probeEgress } from "./probe.server";
import type { TunnelEgressState } from "../shared/tunnel-types.shared";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
  servers.length = 0;
});
async function listen(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  return address.port;
}
const options: RequestOptions = {
  method: "GET",
  path: "/",
  body: "",
  token: "access-secret",
  bearerToken: "upstream-secret",
};
function entry(
  port: number,
  mode: "header" | "bearer" | "none" = "header",
): TunnelEgressState {
  return {
    id: "probe",
    name: "probe",
    enabled: true,
    listen: { host: "0.0.0.0", port },
    ingressHostName: "test",
    ingressName: "test",
    access: { mode, configured: true },
    status: "listening",
  };
}
test("curl executes quoted POST literally, with access and upstream bearer credentials", async () => {
  const received: unknown[] = [];
  const port = await listen((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      received.push({ url: req.url, headers: req.headers, body });
      res.end("ok");
    });
  });
  const special = "a'$(printf INJECTED)`id`";
  const input = {
    ...options,
    path: `/echo?value=${special}`,
    method: "POST" as const,
    body: JSON.stringify({ literal: special }),
    token: special,
  };
  // Spaces must be URL encoded.
  input.path = `/echo?value=${encodeURIComponent(special)}`;
  const command = buildCurl(`http://127.0.0.1:${port}`, "header", input);
  await promisify(execFile)("/bin/sh", ["-c", command]);
  expect(received).toEqual([
    {
      url: input.path,
      headers: expect.objectContaining({
        "x-paseo-access-token": special,
        authorization: "Bearer upstream-secret",
        "content-type": "application/json",
      }),
      body: input.body,
    },
  ]);
});
test("Bearer and unauthenticated modes never mix up credentials", () => {
  expect(requestHeaders("bearer", options)).toEqual({
    Authorization: "Bearer access-secret",
  });
  expect(requestHeaders("none", { ...options, bearerToken: "" })).toEqual({});
  expect(requestHeaders("none", options)).toEqual({
    Authorization: "Bearer upstream-secret",
  });
});
test("rejects origin overrides and malformed HTTP paths/headers", () => {
  for (const origin of [
    "file:///tmp/a",
    "http://user:pass@localhost",
    "http://localhost/a",
    "http://localhost?x=1",
  ]) {
    expect(() => buildCurl(origin, "header", options)).toThrow();
  }
  for (const path of ["//evil.test", "/x\r\nInjected: yes", "/你好", "/a b"]) {
    expect(RequestOptionsSchema.safeParse({ ...options, path }).success).toBe(
      false,
    );
  }
  expect(
    RequestOptionsSchema.safeParse({ ...options, token: "a\r\nb" }).success,
  ).toBe(false);
});
test("probe POST sends both credentials, returns status and redacts echoed tokens", async () => {
  const port = await listen((req, res) => {
    expect(req.headers["x-paseo-access-token"]).toBe(options.token);
    expect(req.headers.authorization).toBe(`Bearer ${options.bearerToken}`);
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      res.setHeader("Content-Type", "text/plain");
      res.end(body + options.token + options.bearerToken);
    });
  });
  const result = await probeEgress(entry(port), {
    ...options,
    method: "POST",
    body: "payload:",
  });
  expect(result).toMatchObject({
    status: 200,
    error: null,
    preview: "payload:[REDACTED][REDACTED]",
    truncated: false,
  });
});
test("HTTP 401 is visible and redirects are not followed", async () => {
  const port = await listen((req, res) => {
    res.statusCode = req.url === "/denied" ? 401 : 302;
    res.setHeader("Location", "http://127.0.0.1:1/");
    res.end("response");
  });
  expect(
    await probeEgress(entry(port), { ...options, path: "/denied" }),
  ).toMatchObject({ status: 401, error: null });
  expect(await probeEgress(entry(port), options)).toMatchObject({
    status: 302,
    error: null,
  });
});
test("caps response preview and cancels unending SSE after first chunk", async () => {
  const port = await listen((req, res) => {
    if (req.url === "/sse") {
      res.setHeader("Content-Type", "text/event-stream");
      res.write("data: hello\n\n");
    } else res.end("x".repeat(12000));
  });
  const result = await probeEgress(entry(port), options);
  expect(result.preview.length).toBe(8192);
  expect(result.truncated).toBe(true);
  expect(
    await probeEgress(entry(port), { ...options, path: "/sse" }),
  ).toMatchObject({ preview: "data: hello\n\n", truncated: true, error: null });
});
test("disabled listeners are not contacted and closed ports report connection failure", async () => {
  const port = await listen((_req, res) => res.end("ok"));
  expect(
    await probeEgress({ ...entry(port), enabled: false }, options),
  ).toMatchObject({ status: null, error: "disabled" });
  servers[0].close();
  await once(servers[0], "close");
  expect(await probeEgress(entry(port), options)).toMatchObject({
    status: null,
    error: "connection",
  });
});

test("slow requests time out and close the connection", async () => {
  const port = await listen((_req, _res) => {});
  const result = await probeEgress(entry(port), options);
  expect(result).toMatchObject({ error: "timeout", status: null });
  expect(result.elapsedMs).toBeGreaterThanOrEqual(9900);
}, 12000);

test("a failed listener never sends credentials to the process occupying its port", async () => {
  let requests = 0;
  const port = await listen((_req, res) => {
    requests++;
    res.end("other service");
  });
  const result = await probeEgress(
    { ...entry(port), status: "error" },
    options,
  );
  expect(result.error).toBe("connection");
  expect(requests).toBe(0);
});
