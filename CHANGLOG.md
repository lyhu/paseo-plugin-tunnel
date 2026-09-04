# Changelog

User-visible changes to Paseo HTTP Tunnel. Versions follow Semantic Versioning; the current source version is defined in `package.json`.

## Unreleased

### Added

- Green/yellow connectivity indicators for Ingresses and Egresses, backed by cached HTTP HEAD checks through the actual route rather than listener state alone.
- Bounded probe concurrency, cancellation on configuration changes, and stale-result handling when the host is unavailable.

## 0.1.0

### Added

- Independent Paseo plugin with an HTTP Tunnel sidebar entry and per-host configuration.
- Ingress and Egress management using Route Offer export and import.
- End-to-end encrypted Relay transport for HTTP/HTTPS services, streaming bodies, and SSE.
- Header, Bearer, and unauthenticated listener modes; separate upstream API authentication in Header mode.
- Credential rotation, private configuration storage, and automatic restoration of enabled rules.
- Theme-aware interface following Paseo's nine supported languages.
- Copyable curl examples and GET/POST verification with HTTP status, duration, and bounded response previews.
- GitHub source installation with automatic runtime dependency preparation; no precompiled release required.
- English and Chinese usage guides, architecture documentation, and Agent installation prompts.

### Security

- Mask the middle of `relayEndpoint`, `tunnelPublicKeyB64`, and `routeSecret` in Route Offer previews. The Copy button retains the complete importable JSON.
- Store Access Tokens as hashes and keep generated plaintext tokens only in the current page's memory.
- Restrict quick verification to running local Egress listeners; redact verbatim token echoes from response previews.
