// Explicit, opt-in smoke test against the installed local Paseo daemon.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
const checkout = process.argv[2];
if (!checkout)
  throw new Error("Usage: tsx scripts/verify-local.mjs /path/to/paseo");
const { connectToDaemon } = await import(
  pathToFileURL(path.join(checkout, "packages/cli/src/utils/client.ts")).href
);
const client = await connectToDaemon({ host: "127.0.0.1:6767" });
const target = createServer((req, res) => {
  if (req.url === "/probe") {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        bearer: req.headers.authorization === "Bearer upstream-test",
        accessStripped: !req.headers["x-paseo-access-token"],
      }),
    );
  } else res.end("local plugin verification");
});
target.listen(0, "127.0.0.1");
await once(target, "listening");
const label = `verification-${randomUUID()}`;
let ingressId;
let egressId;
const rpc = (method, input = {}) =>
  client.invokePluginRpc("http-tunnel", method, input);
try {
  const ingress = await rpc("tunnel.ingress.create", {
    name: label,
    targetOrigin: `http://127.0.0.1:${target.address().port}`,
  });
  ingressId = ingress.state.ingresses.find((entry) => entry.name === label).id;
  assert.equal(ingress.state.relayStatus, "ready");
  const { offer } = await rpc("tunnel.ingress.offer.export", { id: ingressId });
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const egress = await rpc("tunnel.egress.create", {
    name: label,
    listen: { host: "127.0.0.1", port },
    offerString: offer,
    accessMode: "header",
  });
  egressId = egress.state.egresses.find((entry) => entry.name === label).id;
  const url = `http://127.0.0.1:${port}`;
  const headers = { "X-Paseo-Access-Token": egress.oneTimeToken };
  assert.equal((await fetch(url)).status, 401);
  assert.equal(
    await (await fetch(url, { headers })).text(),
    "local plugin verification",
  );
  const verified = await rpc("tunnel.egress.verify", {
    id: egressId,
    path: "/probe",
    method: "GET",
    body: "",
    token: egress.oneTimeToken,
    bearerToken: "upstream-test",
  });
  assert.equal(verified.status, 200);
  assert.deepEqual(JSON.parse(verified.preview), {
    bearer: true,
    accessStripped: true,
  });
  assert.equal(
    (
      await rpc("tunnel.egress.verify", {
        id: egressId,
        path: "/",
        method: "GET",
        body: "",
        token: "wrong-token",
        bearerToken: "",
      })
    ).status,
    401,
  );
  assert.ok(
    !JSON.stringify(await rpc("tunnel.state.get")).includes(
      egress.oneTimeToken,
    ),
  );
  assert.equal((await client.reloadPlugin("http-tunnel")).status, "running");
  await rpc("tunnel.state.get");
  assert.equal(
    await (await fetch(url, { headers })).text(),
    "local plugin verification",
  );
  console.log(
    "PASS: installed local Paseo RPC, configured Relay, E2EE HTTP proxy, dual-token verification RPC, auth and plugin reload",
  );
} finally {
  try {
    if (egressId) await rpc("tunnel.egress.delete", { id: egressId });
  } finally {
    try {
      if (ingressId) await rpc("tunnel.ingress.delete", { id: ingressId });
    } finally {
      await client.close();
      target.closeAllConnections();
      await new Promise((resolve) => target.close(resolve));
    }
  }
}
