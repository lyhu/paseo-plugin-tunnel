import type { PluginServerContext } from "@getpaseo/plugin/server";
import * as Handlers from "./server/handlers";
import * as Rpc from "./shared/tunnel-rpc";

export default function contribute(server: PluginServerContext) {
  server.handle(Rpc.getTunnelState, Handlers.getState);
  server.handle(Rpc.verifyEgress, Handlers.verifyEgress);
  server.handle(Rpc.createIngress, Handlers.createIngress);
  server.handle(Rpc.updateIngress, Handlers.updateIngress);
  server.handle(Rpc.deleteIngress, Handlers.deleteIngress);
  server.handle(Rpc.rotateIngressSecret, Handlers.rotateIngressSecret);
  server.handle(Rpc.exportRouteOffer, Handlers.exportRouteOffer);
  server.handle(Rpc.createEgress, Handlers.createEgress);
  server.handle(Rpc.updateEgress, Handlers.updateEgress);
  server.handle(Rpc.deleteEgress, Handlers.deleteEgress);
  server.handle(Rpc.replaceEgressOffer, Handlers.replaceEgressOffer);
  server.handle(Rpc.rotateEgressToken, Handlers.rotateEgressToken);
  return async () => {
    await Handlers.stopTunnel();
  };
}
