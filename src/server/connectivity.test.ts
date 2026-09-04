import { afterAll, beforeAll, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkOffer, checkOrigin } from "./connectivity.server";
import { ConnectivityMonitor } from "./connectivity-monitor.server";
import { createInProcessRelay, type RelayHarness } from "./relay-test-support";
import { FileTunnelStorage } from "./storage.server";
import { TunnelSubsystem } from "./subsystem.server";
import type { RouteOffer } from "./config.server";
import type { TunnelState } from "../shared/tunnel-types.shared";

let relay: RelayHarness;
let target: Server;
let subsystem: TunnelSubsystem;
let storage: FileTunnelStorage;
let offer: RouteOffer;
let ingressId: string;
let origin: string;
let root: string;
let requests = 0;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "tunnel-connectivity-"));
  relay = await createInProcessRelay();
  target = createServer((req, res) => {
    requests++;
    expect(req.method).toBe("HEAD");
    expect(req.headers.authorization).toBeUndefined();
    res.writeHead(401);
    res.end();
  });
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  const address = target.address();
  if (!address || typeof address === "string") throw new Error("No port");
  origin = `http://127.0.0.1:${address.port}`;
  storage = new FileTunnelStorage(join(root, "config.json"));
  subsystem = new TunnelSubsystem({
    storage,
    relayEndpoint: relay.httpBaseUrl,
    relayUseTls: false,
  });
  await subsystem.start();
  ingressId = (
    await subsystem.createIngress({ name: "health", targetOrigin: origin })
  ).state.ingresses[0].id;
  offer = await subsystem.exportRouteOffer(ingressId);
});
afterAll(async () => {
  await subsystem?.stop();
  target?.closeAllConnections();
  await new Promise<void>((resolve) => target?.close(() => resolve()));
  await relay?.stop();
  rmSync(root, { recursive: true, force: true });
});
const signal = () => new AbortController().signal;

test("HEAD checks verify direct and encrypted HTTP reachability without business credentials", async () => {
  expect(await checkOrigin(origin, signal())).toBe(401);
  expect(await checkOffer(offer, signal())).toBe(401);
});

test("an invalid Route Offer is offline even while Relay is reachable", async () => {
  const before = requests;
  expect(
    await checkOffer({ ...offer, routeSecret: "invalid-secret" }, signal()),
  ).toBeNull();
  expect(requests).toBe(before);
});

test("checks are cached across viewers and disabling a rule invalidates green immediately", async () => {
  const monitor = new ConnectivityMonitor();
  try {
    const before = requests;
    const state = subsystem.getState();
    expect(
      monitor.snapshot(state, storage.load()).ingresses[0].connectivity?.state,
    ).toBe("checking");
    for (let i = 0; i < 10; i++) monitor.snapshot(state, storage.load());
    await expect
      .poll(
        () =>
          monitor.snapshot(state, storage.load()).ingresses[0].connectivity
            ?.state,
      )
      .toBe("online");
    expect(requests - before).toBe(1);
    const disabled: TunnelState = {
      ...state,
      ingresses: state.ingresses.map((entry) => ({
        ...entry,
        enabled: false,
        status: "disabled",
      })),
    };
    expect(
      monitor.snapshot(disabled, storage.load()).ingresses[0].connectivity,
    ).toMatchObject({ state: "offline", reason: "disabled" });
  } finally {
    monitor.stop();
  }
});

test("monitors limit concurrency and shutdown cancels active probes", async () => {
  let received = 0;
  const hanging = createServer(() => {
    received++;
  });
  hanging.listen(0, "127.0.0.1");
  await once(hanging, "listening");
  const addr = hanging.address();
  if (!addr || typeof addr === "string") throw new Error("No port");
  const monitor = new ConnectivityMonitor();
  try {
    const state: TunnelState = {
      relayStatus: "ready",
      egresses: [],
      ingresses: Array.from({ length: 9 }, (_, i) => ({
        id: String(i),
        name: String(i),
        enabled: true,
        status: "ready",
        targetOrigin: `http://127.0.0.1:${addr.port}`,
      })),
    };
    monitor.snapshot(state, {});
    await expect.poll(() => received).toBe(4);
    monitor.stop();
    await expect
      .poll(
        () =>
          new Promise<number>((resolve, reject) =>
            hanging.getConnections((error, count) =>
              error ? reject(error) : resolve(count),
            ),
          ),
      )
      .toBe(0);
    expect(received).toBe(4);
  } finally {
    monitor.stop();
    hanging.closeAllConnections();
    await new Promise<void>((resolve) => hanging.close(() => resolve()));
  }
});

test("route rotation invalidates old offers and stopping the target removes connectivity", async () => {
  await subsystem.rotateIngressSecret(ingressId);
  expect(await checkOffer(offer, signal())).toBeNull();
  const fresh = await subsystem.exportRouteOffer(ingressId);
  expect(await checkOffer(fresh, signal())).toBe(401);
  target.closeAllConnections();
  await new Promise<void>((resolve) => target.close(() => resolve()));
  expect(await checkOrigin(origin, signal())).toBeNull();
  expect(await checkOffer(fresh, signal())).toBeNull();
});
