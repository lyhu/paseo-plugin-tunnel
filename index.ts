import type { PluginContext } from "@getpaseo/plugin";
import { TunnelView } from "./src/client/tunnel-view.client";
import * as Rpc from "./src/shared/tunnel-rpc.shared";
import * as Handlers from "./src/server/handlers.server";

export default function contribute(plugin: PluginContext) {
  plugin.handle(Rpc.getTunnelState, Handlers.getState);
  plugin.handle(Rpc.verifyEgress, Handlers.verifyEgress);
  plugin.handle(Rpc.createIngress, Handlers.createIngress);
  plugin.handle(Rpc.updateIngress, Handlers.updateIngress);
  plugin.handle(Rpc.deleteIngress, Handlers.deleteIngress);
  plugin.handle(Rpc.rotateIngressSecret, Handlers.rotateIngressSecret);
  plugin.handle(Rpc.exportRouteOffer, Handlers.exportRouteOffer);
  plugin.handle(Rpc.createEgress, Handlers.createEgress);
  plugin.handle(Rpc.updateEgress, Handlers.updateEgress);
  plugin.handle(Rpc.deleteEgress, Handlers.deleteEgress);
  plugin.handle(Rpc.replaceEgressOffer, Handlers.replaceEgressOffer);
  plugin.handle(Rpc.rotateEgressToken, Handlers.rotateEgressToken);
  plugin.addSurface("tunnel-main", TunnelView);
  plugin.addSidebarItem({
    id: "tunnel",
    title: "HTTP Tunnel",
    icon: "Network",
    surface: "tunnel-main",
  });
  // The host compiler strips the server import in the client entry point.
  return async () => {
    if (typeof Handlers !== "undefined") await Handlers.stopTunnel();
  };
}
