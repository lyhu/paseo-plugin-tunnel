import type { PluginClientContext } from "@getpaseo/plugin/client";
import { TunnelView } from "./client/tunnel-view";

export default function contribute(client: PluginClientContext) {
  const removeSidebarItem = client.addSidebarItem({
    id: "tunnel",
    title: "HTTP Tunnel",
    icon: "Network",
    surface: "tunnel-main",
  });
  const removeSurface = client.addSurface("tunnel-main", TunnelView);
  return () => {
    removeSidebarItem();
    removeSurface();
  };
}
