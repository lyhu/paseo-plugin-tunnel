import { z } from "zod";

export const RequestOptionsSchema = z.object({
  path: z
    .string()
    .max(2048)
    .regex(/^\/(?!\/)[\x21-\x22\x24-\x7e]*$/),
  method: z.enum(["GET", "POST"]),
  body: z.string().max(16384),
  token: z
    .string()
    .max(1024)
    .regex(/^[\x20-\x7e]*$/),
  bearerToken: z
    .string()
    .max(1024)
    .regex(/^[\x20-\x7e]*$/),
});
export type RequestOptions = z.infer<typeof RequestOptionsSchema>;
export type AccessMode = "header" | "bearer" | "none";

export const ProbeResultSchema = z.object({
  status: z.number().int().nullable(),
  elapsedMs: z.number(),
  contentType: z.string(),
  preview: z.string(),
  truncated: z.boolean(),
  error: z.enum(["timeout", "connection", "disabled"]).nullable(),
});
export type ProbeResult = z.infer<typeof ProbeResultSchema>;

export function requestHeaders(
  mode: AccessMode,
  options: RequestOptions,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (mode === "header" && options.token)
    headers["X-Paseo-Access-Token"] = options.token;
  const bearer = mode === "bearer" ? options.token : options.bearerToken;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (options.method === "POST") headers["Content-Type"] = "application/json";
  return headers;
}

export function buildCurl(
  origin: string,
  mode: AccessMode,
  options: RequestOptions,
): string {
  RequestOptionsSchema.parse(options);
  const url = new URL(origin);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Invalid origin");
  const args = [
    "curl",
    "--include",
    "--globoff",
    "--path-as-is",
    "--no-buffer",
    "--request",
    options.method,
    quote(`${url.origin}${options.path}`),
  ];
  for (const [name, value] of Object.entries(requestHeaders(mode, options)))
    args.push("--header", quote(`${name}: ${value}`));
  if (options.method === "POST") args.push("--data-raw", quote(options.body));
  return args.join(" ");
}
function quote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
