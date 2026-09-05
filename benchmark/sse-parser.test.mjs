import { test } from "node:test";
import assert from "node:assert/strict";
import { createSseParser } from "./sse-parser.mjs";

test("SSE parsing is independent of HTTP chunk boundaries", () => {
  const stream =
    ': ping\r\ndata: {"text":\r\ndata: "hello"}\r\n\r\ndata: [DONE]\n\n';
  for (let split = 0; split <= stream.length; split++) {
    const events = [];
    const feed = createSseParser((event) => events.push(event));
    feed(stream.slice(0, split));
    feed(stream.slice(split));
    assert.deepEqual(events, ['{"text":\n"hello"}', "[DONE]"]);
  }
});
