import {
  RouteOfferSchema,
  type RouteOffer,
} from "../shared/tunnel-types.shared.js";
import { importPublicKey } from "@getpaseo/relay/e2ee";

export function parseRouteOffer(value: string): RouteOffer {
  try {
    const offer = RouteOfferSchema.parse(JSON.parse(value));
    const endpoint = offer.relayEndpoint.includes("://")
      ? offer.relayEndpoint
      : `https://${offer.relayEndpoint}`;
    const url = new URL(endpoint);
    if (
      !["http:", "https:", "ws:", "wss:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      throw new Error();
    importPublicKey(offer.tunnelPublicKeyB64);
    return offer;
  } catch {
    // Offers are capabilities. Never echo invalid input into RPC errors/logs.
    throw new Error(
      "Invalid Route Offer. Paste the complete JSON exported by the Ingress host.",
    );
  }
}
