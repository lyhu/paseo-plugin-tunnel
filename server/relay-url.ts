interface TunnelRelayUrlOptions {
  endpoint: string;
  useTls: boolean;
  serverId: string;
  role: "client" | "server";
  connectionId?: string;
}

export function buildTunnelRelayUrl(options: TunnelRelayUrlOptions): string {
  const url = new URL(
    options.endpoint.includes("://")
      ? options.endpoint
      : `${options.useTls ? "https" : "http"}://${options.endpoint}`,
  );
  url.protocol = options.useTls ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  url.searchParams.set("serverId", options.serverId);
  url.searchParams.set("role", options.role);
  url.searchParams.set("v", "2");
  if (options.connectionId)
    url.searchParams.set("connectionId", options.connectionId);
  return url.toString();
}
