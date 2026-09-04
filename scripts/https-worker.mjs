import assert from "node:assert/strict";
import { TunnelSubsystem } from "../src/server/subsystem.server.ts";
import { FileTunnelStorage } from "../src/server/storage.server.ts";
const [relayEndpoint, targetOrigin, configPath] = process.argv.slice(2);
const tunnel = new TunnelSubsystem({
  storage: new FileTunnelStorage(configPath),
  relayEndpoint,
  relayUseTls: false,
});
try {
  const result = await tunnel.createIngress({
    name: "HTTPS origin",
    targetOrigin,
  });
  const offer = await tunnel.exportRouteOffer(result.state.ingresses[0].id);
  const egress = await tunnel.createEgress({
    name: "HTTPS egress",
    offer,
    listen: { host: "127.0.0.1", port: 0 },
    access: { mode: "none" },
  });
  const response = await fetch(
    `http://127.0.0.1:${egress.state.egresses[0].listen.port}/trusted`,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "trusted HTTPS origin");
  console.log("PASS: HTTPS origin with normal CA verification");
} finally {
  await tunnel.stop();
}
