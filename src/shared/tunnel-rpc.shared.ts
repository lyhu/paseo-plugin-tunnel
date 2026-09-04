import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";
import {
  PortSchema,
  TargetOriginSchema,
  TunnelListenHostSchema,
  TunnelStateSchema,
} from "./tunnel-types.shared.js";

const id = z.object({ id: z.string().min(1) });
const name = z
  .string()
  .trim()
  .min(1, "Enter a name for this rule")
  .max(128, "Use a name under 128 characters");
const listen = z.object({ host: TunnelListenHostSchema, port: PortSchema });
const mode = z.enum(["bearer", "header", "none"]);
const token = z.string().min(8).max(1024).optional();
const offerString = z.string().min(1).max(16384);
const result = z.object({
  state: TunnelStateSchema,
  oneTimeToken: z.string().optional(),
});

export const getTunnelState = defineRpc({
  name: "tunnel.state.get",
  input: z.object({}),
  output: TunnelStateSchema,
});
export const createIngress = defineRpc({
  name: "tunnel.ingress.create",
  input: z.object({ name, targetOrigin: TargetOriginSchema }),
  output: result,
});
export const updateIngress = defineRpc({
  name: "tunnel.ingress.update",
  input: id.extend({
    name: name.optional(),
    targetOrigin: TargetOriginSchema.optional(),
    enabled: z.boolean().optional(),
  }),
  output: result,
});
export const deleteIngress = defineRpc({
  name: "tunnel.ingress.delete",
  input: id,
  output: result,
});
export const rotateIngressSecret = defineRpc({
  name: "tunnel.ingress.secret.rotate",
  input: id,
  output: result,
});
export const exportRouteOffer = defineRpc({
  name: "tunnel.ingress.offer.export",
  input: id,
  output: z.object({ offer: z.string() }),
});
export const createEgress = defineRpc({
  name: "tunnel.egress.create",
  input: z.object({
    name,
    listen,
    offerString,
    accessMode: mode,
    customToken: token,
  }),
  output: result,
});
export const updateEgress = defineRpc({
  name: "tunnel.egress.update",
  input: id.extend({
    name: name.optional(),
    listen: listen.optional(),
    enabled: z.boolean().optional(),
  }),
  output: result,
});
export const deleteEgress = defineRpc({
  name: "tunnel.egress.delete",
  input: id,
  output: result,
});
export const replaceEgressOffer = defineRpc({
  name: "tunnel.egress.offer.replace",
  input: id.extend({ offerString }),
  output: result,
});
export const rotateEgressToken = defineRpc({
  name: "tunnel.egress.token.rotate",
  input: id.extend({ mode, token }),
  output: result,
});

import { RequestOptionsSchema, ProbeResultSchema } from "./request.shared.js";
export const verifyEgress = defineRpc({
  name: "tunnel.egress.verify",
  input: RequestOptionsSchema.extend({ id: z.string().min(1) }),
  output: ProbeResultSchema,
});
