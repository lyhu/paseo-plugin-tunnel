import { z } from "zod";

// Sanitized state schemas (no secrets)
export const TunnelIngressStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  targetOrigin: z.string(),
  status: z.enum(["disabled", "ready", "error"]),
});

export const TunnelEgressStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  listen: z.object({
    host: z.string(),
    port: z.number(),
  }),
  ingressHostName: z.string(),
  ingressName: z.string(),
  access: z.object({
    mode: z.enum(["bearer", "header", "none"]),
    configured: z.boolean(),
  }),
  status: z.enum(["disabled", "starting", "listening", "error"]),
  error: z.string().optional(),
});

export const TunnelRelayStatusSchema = z.enum([
  "inactive",
  "connecting",
  "ready",
  "error",
]);

export const TunnelStateSchema = z.object({
  relayStatus: TunnelRelayStatusSchema,
  ingresses: z.array(TunnelIngressStateSchema),
  egresses: z.array(TunnelEgressStateSchema),
});

export const PortSchema = z.number().int().min(1).max(65535);
export const TargetOriginSchema = z.string().refine(
  (value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.hostname &&
        (url.pathname === "/" || url.pathname === "") &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  },
  {
    message:
      "Target origin must be http(s)://host[:port] with no path, query, or fragment",
  },
);
export const TunnelListenHostSchema = z.enum(["127.0.0.1", "0.0.0.0"]);
export const RouteOfferSchema = z
  .object({
    protocolVersion: z.literal(1),
    relayEndpoint: z.string().min(1),
    relayUseTls: z.boolean(),
    tunnelServerId: z.string().min(1),
    tunnelPublicKeyB64: z.string().min(1),
    routeId: z.string().min(1),
    routeSecret: z.string().min(1),
    ingressHostName: z.string().min(1),
    ingressName: z.string().min(1),
    suggestedPort: PortSchema,
  })
  .strict();

export type TunnelIngressState = z.infer<typeof TunnelIngressStateSchema>;
export type TunnelEgressState = z.infer<typeof TunnelEgressStateSchema>;
export type TunnelRelayStatus = z.infer<typeof TunnelRelayStatusSchema>;
export type TunnelState = z.infer<typeof TunnelStateSchema>;
export type RouteOffer = z.infer<typeof RouteOfferSchema>;
export type TunnelListenHost = z.infer<typeof TunnelListenHostSchema>;
