import { describe, expect, test } from "vitest";
import { buildTunnelRelayUrl } from "./relay-url.server.js";

describe("buildTunnelRelayUrl", () => {
  test.each([
    {
      endpoint: "relay.paseo.sh:443",
      useTls: true,
      expected: "wss://relay.paseo.sh/ws",
    },
    {
      endpoint: "http://127.0.0.1:8481",
      useTls: false,
      expected: "ws://127.0.0.1:8481/ws",
    },
    {
      endpoint: "https://relay.example.test/base/path",
      useTls: true,
      expected: "wss://relay.example.test/ws",
    },
  ])("supports $endpoint", ({ endpoint, useTls, expected }) => {
    const url = new URL(
      buildTunnelRelayUrl({
        endpoint,
        useTls,
        serverId: "tunnel_server",
        role: "server",
        connectionId: "connection_1",
      }),
    );

    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(expected);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      serverId: "tunnel_server",
      role: "server",
      v: "2",
      connectionId: "connection_1",
    });
  });
});
