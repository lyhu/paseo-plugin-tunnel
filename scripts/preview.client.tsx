import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PluginRpcProvider } from "@getpaseo/plugin/host";
import { TunnelView } from "../src/client/tunnel-view.client";
const query = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const params = new URLSearchParams(location.search);
const dark = params.get("theme") !== "light";
const theme = {
  colors: {
    surface0: dark ? "#15171a" : "#ffffff",
    foreground: dark ? "#f0f2f5" : "#202226",
    foregroundMuted: dark ? "#a2aab7" : "#5e6470",
    accent: "#477ce8",
    accentForeground: "#ffffff",
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
