import { RouteOfferSchema } from "../shared/tunnel-types.shared";

// Display-only: the copy action must keep using the original Offer string.
export function routeOfferPreview(value: string): string {
  try {
    const offer = RouteOfferSchema.parse(JSON.parse(value));
    return JSON.stringify({
      ...offer,
      relayEndpoint: maskMiddle(offer.relayEndpoint),
      tunnelPublicKeyB64: maskMiddle(offer.tunnelPublicKeyB64),
      routeSecret: maskMiddle(offer.routeSecret),
    });
  } catch {
    return "******";
  }
}

function maskMiddle(value: string): string {
  const edge = Math.min(8, Math.floor(value.length / 3));
  return edge === 0
    ? "******"
    : `${value.slice(0, edge)}******${value.slice(-edge)}`;
}
