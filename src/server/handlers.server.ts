import { ConnectivityMonitor } from "./connectivity-monitor.server.js";
import { probeEgress } from "./probe.server.js";
import type { output as Output } from "zod";
import type * as Rpc from "../shared/tunnel-rpc.shared.js";
import { TunnelSubsystem } from "./subsystem.server.js";
import { FileTunnelStorage } from "./storage.server.js";
import { parseRouteOffer } from "./offer.server.js";

const connectivity = new ConnectivityMonitor();
const storage = new FileTunnelStorage();
const relay = storage.load().relay;
const subsystem = new TunnelSubsystem({
  storage,
  relayEndpoint: relay?.endpoint ?? "relay.paseo.sh:443",
  relayUseTls: relay?.useTls ?? true,
  relayPublicEndpoint: relay?.publicEndpoint,
  relayPublicUseTls: relay?.publicUseTls,
});
const ready = subsystem.start();
// Handle startup rejection immediately; RPCs still receive the rejected promise.
void ready.catch(() =>
  console.error("HTTP Tunnel startup failed. Check the tunnel configuration."),
);

export async function getState() {
  await ready;
  return connectivity.snapshot(subsystem.getState(), storage.load());
}
export async function createIngress(
  input: Output<typeof Rpc.createIngress.input>,
) {
  await ready;
  return subsystem.createIngress(input);
}
export async function updateIngress(
  input: Output<typeof Rpc.updateIngress.input>,
) {
  await ready;
  return subsystem.updateIngress(input);
}
export async function deleteIngress({
  id,
}: Output<typeof Rpc.deleteIngress.input>) {
  await ready;
  return subsystem.deleteIngress(id);
}
export async function rotateIngressSecret({
  id,
}: Output<typeof Rpc.rotateIngressSecret.input>) {
  await ready;
  return subsystem.rotateIngressSecret(id);
}
export async function exportRouteOffer({
  id,
}: Output<typeof Rpc.exportRouteOffer.input>) {
  await ready;
  return { offer: JSON.stringify(await subsystem.exportRouteOffer(id)) };
}
export async function createEgress(
  input: Output<typeof Rpc.createEgress.input>,
) {
  await ready;
  return subsystem.createEgress({
    name: input.name,
    listen: input.listen,
    offer: parseRouteOffer(input.offerString),
    access: { mode: input.accessMode, token: input.customToken },
  });
}
export async function updateEgress(
  input: Output<typeof Rpc.updateEgress.input>,
) {
  await ready;
  return subsystem.updateEgress(input);
}
export async function deleteEgress({
  id,
}: Output<typeof Rpc.deleteEgress.input>) {
  await ready;
  return subsystem.deleteEgress(id);
}
export async function replaceEgressOffer({
  id,
  offerString,
}: Output<typeof Rpc.replaceEgressOffer.input>) {
  await ready;
  return subsystem.replaceEgressOffer(id, parseRouteOffer(offerString));
}
export async function rotateEgressToken({
  id,
  ...options
}: Output<typeof Rpc.rotateEgressToken.input>) {
  await ready;
  return subsystem.rotateEgressToken(id, options);
}
export async function stopTunnel() {
  connectivity.stop();
  await subsystem.stop();
}

export async function verifyEgress(
  input: Output<typeof Rpc.verifyEgress.input>,
) {
  await ready;
  const entry = subsystem
    .getState()
    .egresses.find((item) => item.id === input.id);
  if (!entry) throw new Error("Egress not found");
  return probeEgress(entry, input);
}
