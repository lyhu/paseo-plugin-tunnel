import { describe, expect, it } from "vitest";
import {
  FLOW_WINDOW_BYTES,
  FRAME_BYTES,
  TunnelCreditWindow,
  TunnelStreamOrder,
  decodeTunnelFrame,
  encodeTunnelFrame,
} from "./tunnel-wire.server.js";

describe("Tunnel wire protocol", () => {
  it("round-trips a request head with repeated headers", () => {
    const frame = decodeTunnelFrame(
      encodeTunnelFrame({
        v: 1,
        type: "request.head",
        method: "POST",
        path: "/v1/chat/completions?stream=true",
        routeId: "route_1",
        routeSecret: "secret_1",
        client: {
          address: "127.0.0.1",
          host: "caller.example",
          protocol: "http",
        },
        headers: [
          ["x-example", "one"],
          ["x-example", "two"],
        ],
      }),
    );

    expect(frame).toEqual({
      v: 1,
      type: "request.head",
      method: "POST",
      path: "/v1/chat/completions?stream=true",
      routeId: "route_1",
      routeSecret: "secret_1",
      client: {
        address: "127.0.0.1",
        host: "caller.example",
        protocol: "http",
      },
      headers: [
        ["x-example", "one"],
        ["x-example", "two"],
      ],
    });
  });

  it("only allows eight 64 KiB chunks before acknowledgement", () => {
    const window = new TunnelCreditWindow();

    for (let index = 0; index < 8; index += 1) window.reserve(FRAME_BYTES);

    expect(window.usedBytes).toBe(FLOW_WINDOW_BYTES);
    expect(() => window.reserve(1)).toThrow("credit window exhausted");
    window.acknowledge(FRAME_BYTES);
    window.reserve(1);
    expect(window.usedBytes).toBe(FLOW_WINDOW_BYTES - FRAME_BYTES + 1);
  });

  it("also limits small frames to eight outstanding chunks", () => {
    const window = new TunnelCreditWindow();
    for (let index = 0; index < 8; index++) window.reserve(1);
    expect(() => window.reserve(1)).toThrow("credit window exhausted");
    window.acknowledge(1);
    window.reserve(1);
    expect(window.usedBytes).toBe(8);
  });

  it("keeps the oldest credit reservation when an acknowledgement is wrong", () => {
    const window = new TunnelCreditWindow();
    window.reserve(100);
    window.reserve(200);

    expect(() => window.acknowledge(200)).toThrow(
      "does not match oldest outstanding chunk",
    );
    expect(window.usedBytes).toBe(300);

    window.acknowledge(100);
    expect(window.usedBytes).toBe(200);
  });

  it("rejects body and end frames outside head-body-end order", () => {
    const stream = new TunnelStreamOrder();

    expect(() => stream.acceptBody()).toThrow("body before head");
    expect(() => stream.acceptEnd()).toThrow("end before head");

    stream.acceptHead();
    stream.acceptBody();
    expect(() => stream.acceptHead()).toThrow("duplicate head");
    stream.acceptEnd();

    expect(() => stream.acceptBody()).toThrow("body after end");
    expect(() => stream.acceptEnd()).toThrow("duplicate end");
  });

  it("rejects malformed or oversized protocol frames", () => {
    expect(() =>
      decodeTunnelFrame('{"type":"request.head","method":"GET"}'),
    ).toThrow("Invalid Tunnel frame");
    expect(() => new TunnelCreditWindow().reserve(FRAME_BYTES + 1)).toThrow(
      "chunk exceeds 65536 byte limit",
    );
  });

  it("accepts only fixed public error codes", () => {
    expect(
      decodeTunnelFrame('{"v":1,"type":"error","code":"ROUTE_NOT_FOUND"}'),
    ).toEqual({
      v: 1,
      type: "error",
      code: "ROUTE_NOT_FOUND",
    });
    expect(() =>
      decodeTunnelFrame(
        '{"v":1,"type":"error","code":"http://internal.example"}',
      ),
    ).toThrow("Invalid Tunnel frame");
  });
});
