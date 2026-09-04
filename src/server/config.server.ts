import {
  TargetOriginSchema,
  RouteOfferSchema,
  TunnelListenHostSchema,
  PortSchema,
} from "../shared/tunnel-types.shared.js";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import {
  exportPublicKey,
  exportSecretKey,
  generateKeyPair,
} from "@getpaseo/relay/e2ee";

const TunnelIdentitySchema = z
  .object({
    serverId: z.string().min(1),
    publicKeyB64: z.string().min(1),
    secretKeyB64: z.string().min(1),
  })
  .strict();

const PersistedIngressSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean(),
    targetOrigin: TargetOriginSchema,
    routeId: z.string().min(1),
    routeSecret: z.string().min(1),
  })
  .strict();

const EgressAccessSchema = z
  .object({
    mode: z.enum(["bearer", "header", "none"]),
    tokenHash: z.string().optional(),
  })
  .strict();

const PersistedEgressSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean(),
    listen: z
      .object({
        host: TunnelListenHostSchema,
        port: PortSchema,
      })
      .strict(),
    offer: RouteOfferSchema,
    access: EgressAccessSchema,
  })
  .strict();

export const PersistedTunnelConfigSchema = z
  .object({
    relay: z
      .object({
        endpoint: z.string().min(1),
        useTls: z.boolean(),
        publicEndpoint: z.string().min(1).optional(),
        publicUseTls: z.boolean().optional(),
      })
      .strict()
      .optional(),
    identity: TunnelIdentitySchema.optional(),
    ingresses: z.array(PersistedIngressSchema).optional(),
    egresses: z.array(PersistedEgressSchema).optional(),
  })
  .strict();

export type PersistedTunnelConfig = z.infer<typeof PersistedTunnelConfigSchema>;
export type TunnelIdentity = z.infer<typeof TunnelIdentitySchema>;
export type PersistedIngress = z.infer<typeof PersistedIngressSchema>;
export type PersistedEgress = z.infer<typeof PersistedEgressSchema>;
export type {
  RouteOffer,
  TunnelListenHost,
} from "../shared/tunnel-types.shared.js";
export type EgressAccess = z.infer<typeof EgressAccessSchema>;

export function createTunnelIdentity(): TunnelIdentity {
  const keyPair = generateKeyPair();
  const serverId = `tunnel_${randomBytes(8).toString("hex")}`;

  return {
    serverId,
    publicKeyB64: exportPublicKey(keyPair.publicKey),
    secretKeyB64: exportSecretKey(keyPair.secretKey),
  };
}
