import http from "node:http";
import https from "node:https";
import { createSseParser } from "./sse-parser.mjs";
import { performance } from "node:perf_hooks";
const url = process.env.BENCH_URL ?? "http://127.0.0.1:1380/v1/messages";
const model = process.env.BENCH_MODEL ?? "your-model";
const body = JSON.stringify({
  model,
  messages: [{ role: "user", content: "请解释一下什么是量子纠缠" }],
  max_tokens: 1000,
  stream: true,
  extra_body: {
    chat_template_kwargs: { enable_thinking: true, reasoning_effort: "high" },
  },
});
const start = performance.now();
let headersMs = null,
  firstEventMs = null,
  firstOutputMs = null,
  firstTextMs = null,
  lastOutputMs = null;
let events = 0,
  chunks = 0,
  chars = 0,
  thinkingChars = 0,
  textChars = 0,
  bytes = 0,
  usage = null,
  stopReason = null,
  streamComplete = false,
  finished = false;
const gaps = [];
const errors = [];
function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  if (error || errors.length || firstOutputMs === null || !streamComplete)
    process.exitCode = 1;
  const sorted = gaps.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      label: process.env.BENCH_LABEL ?? "endpoint",
      httpStatus: status,
      error: error ?? null,
      headersMs,
      firstEventMs,
      firstOutputMs,
      firstTextMs,
      totalMs: performance.now() - start,
      lastOutputMs,
      events,
      chunks,
      bytes,
      chars,
      thinkingChars,
      textChars,
      outputSpanMs:
        firstOutputMs !== null && lastOutputMs !== null
          ? lastOutputMs - firstOutputMs
          : null,
      medianOutputGapMs: sorted[Math.floor(sorted.length * 0.5)] ?? null,
      p95OutputGapMs:
        sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ??
        null,
      maxOutputGapMs: sorted.at(-1) ?? null,
      usage,
      stopReason,
      streamComplete,
      errors,
    }),
  );
}
function event(data) {
  if (!data || data === "[DONE]") return;
  let e;
  try {
    e = JSON.parse(data);
  } catch {
    return;
  }
  events++;
  const now = performance.now() - start;
  firstEventMs ??= now;
  if (e.type === "error") errors.push("stream_error");
  const reportedUsage = e.usage ?? e.message?.usage;
  if (reportedUsage) {
    usage ??= {};
    for (const key of [
      "input_tokens",
      "output_tokens",
      "cache_read_input_tokens",
      "cache_creation_input_tokens",
    ]) {
      if (typeof reportedUsage[key] === "number")
        usage[key] = reportedUsage[key];
    }
  }
  if (e.type === "message_stop") streamComplete = true;
  if (
    ["end_turn", "max_tokens", "stop_sequence", "tool_use"].includes(
      e.delta?.stop_reason,
    )
  )
    stopReason = e.delta.stop_reason;
  const thinking = e.delta?.thinking ?? "";
  const text = e.delta?.text ?? "";
  if (thinking || text) {
    firstOutputMs ??= now;
    if (text) firstTextMs ??= now;
    if (lastOutputMs !== null) gaps.push(now - lastOutputMs);
    lastOutputMs = now;
    chars += thinking.length + text.length;
    thinkingChars += thinking.length;
    textChars += text.length;
  }
}
let status = null;
const feed = createSseParser(event);
const req = (new URL(url).protocol === "https:" ? https : http).request(
  url,
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.BENCH_API_KEY ?? "dummy",
      ...(process.env.BENCH_ACCESS_TOKEN
        ? { "X-Paseo-Access-Token": process.env.BENCH_ACCESS_TOKEN }
        : {}),
      ...(process.env.BENCH_BEARER_TOKEN
        ? { Authorization: `Bearer ${process.env.BENCH_BEARER_TOKEN}` }
        : {}),
      "anthropic-version": "2023-06-01",
      "content-length": Buffer.byteLength(body),
    },
  },
  (res) => {
    status = res.statusCode;
    headersMs = performance.now() - start;
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      chunks++;
      bytes += Buffer.byteLength(chunk);
      feed(chunk);
    });
    res.on("end", () => finish(status === 200 ? null : `HTTP ${status}`));
    res.on("error", () => finish("response_error"));
  },
);
const deadline = setTimeout(
  () => req.destroy(new Error("120s total timeout")),
  120000,
);
req.on("socket", (socket) => {
  if (socket.connecting) {
    const timer = setTimeout(
      () => req.destroy(new Error("8s connection timeout")),
      8000,
    );
    socket.once("connect", () => clearTimeout(timer));
    socket.once("close", () => clearTimeout(timer));
  }
});
req.on("error", () => finish("connection_or_timeout_error"));
req.end(body);
