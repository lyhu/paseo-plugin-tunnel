import { expect, test } from "vitest";
import { routeOfferPreview } from "./route-offer-preview.shared";

const offer = {
  protocolVersion: 1,
  relayEndpoint: "relay.example.com:443",
  relayUseTls: true,
  tunnelServerId: "tunnel_test",
  tunnelPublicKeyB64: "public-key-for-preview-verification",
  routeId: "route_test",
  routeSecret: "secret-for-preview-verification",
  ingressHostName: "host",
  ingressName: "service",
  suggestedPort: 8080,
};

test("masks only the three display fields and preserves the original copy payload", () => {
  const original = JSON.stringify(offer);
  const preview = JSON.parse(routeOfferPreview(original));
  for (const field of [
    "relayEndpoint",
    "tunnelPublicKeyB64",
    "routeSecret",
  ] as const) {
    expect(preview[field]).toContain("******");
    expect(preview[field]).not.toBe(offer[field]);
    expect(preview[field].startsWith(offer[field].slice(0, 6))).toBe(true);
    expect(preview[field].endsWith(offer[field].slice(-6))).toBe(true);
    delete preview[field];
  }
  const {
    relayEndpoint: _endpoint,
    tunnelPublicKeyB64: _key,
    routeSecret: _secret,
    ...rest
  } = offer;
  expect(preview).toEqual(rest);
  expect(JSON.parse(original)).toEqual(offer);
});

test("short values are never displayed in full", () => {
  const preview = JSON.parse(
    routeOfferPreview(
      JSON.stringify({
        ...offer,
        relayEndpoint: "ab",
        tunnelPublicKeyB64: "a",
        routeSecret: "x",
      }),
    ),
  );
  expect(preview.relayEndpoint).toBe("******");
  expect(preview.tunnelPublicKeyB64).toBe("******");
  expect(preview.routeSecret).toBe("******");
});

test("malformed offers cannot fall back to displaying raw credentials", () => {
  expect(routeOfferPreview("private-value")).toBe("******");
  expect(
    routeOfferPreview(JSON.stringify({ routeSecret: "private-value" })),
  ).toBe("******");
});
