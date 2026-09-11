import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PluginRpcProvider } from "@getpaseo/plugin/client/host";
import { TunnelView } from "../client/tunnel-view";
const query = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const params = new URLSearchParams(location.search);
const dark = params.get("theme") !== "light";
const theme = {
  colors: {
    surface0: dark ? "#15171a" : "#ffffff",
    surface1: dark ? "#1b1e22" : "#f6f7f9",
    surface2: dark ? "#22262b" : "#eceef2",
    border: dark ? "#333940" : "#d7dbe1",
    foreground: dark ? "#f0f2f5" : "#202226",
    foregroundMuted: dark ? "#a2aab7" : "#5e6470",
    accent: "#477ce8",
    accentForeground: "#ffffff",
    statusSuccess: dark ? "#7ddc9a" : "#147a3a",
    statusWarning: dark ? "#f0c674" : "#8a5a00",
    statusDanger: dark ? "#ff8c8c" : "#b51b30",
  },
};
async function invoke(method: string, input: unknown) {
  const response = await fetch("/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, input }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error);
  return payload;
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={query}>
    <PluginRpcProvider invoke={invoke}>
      <TunnelView
        theme={theme}
        layout={{ compact: innerWidth < 700, platform: "web" }}
        host={{ id: "isolated-test", label: "Isolated test host" }}
      />
    </PluginRpcProvider>
  </QueryClientProvider>,
);
