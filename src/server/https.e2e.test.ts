import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:https";
import { once } from "node:events";
import { createInProcessRelay } from "./relay-test-support.js";
const run = promisify(execFile);

it("forwards to HTTPS origins with certificate verification enabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "tunnel-https-"));
  const relay = await createInProcessRelay();
  const key = join(root, "key.pem");
  const cert = join(root, "cert.pem");
  let target: ReturnType<typeof createServer> | undefined;
  try {
    await run("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ]);
    target = createServer(
      { key: await readFile(key), cert: await readFile(cert) },
      (_req, res) => res.end("trusted HTTPS origin"),
    );
    target.listen(0, "127.0.0.1");
    await once(target, "listening");
    const address = target.address();
    if (!address || typeof address === "string")
      throw new Error("Missing HTTPS port");
    const result = await run(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/https-worker.mjs",
        relay.httpBaseUrl,
        `https://127.0.0.1:${address.port}`,
        join(root, "config.json"),
      ],
      { env: { ...process.env, NODE_EXTRA_CA_CERTS: cert }, timeout: 10000 },
    );
    expect(result.stdout).toContain(
      "PASS: HTTPS origin with normal CA verification",
    );
  } finally {
    if (target) {
      target.closeAllConnections();
      await new Promise<void>((resolve) => target!.close(() => resolve()));
    }
    await relay.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
