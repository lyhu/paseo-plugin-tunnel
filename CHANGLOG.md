# Changelog

User-visible changes to Paseo HTTP Tunnel. Versions follow Semantic Versioning; the current source version is defined in `package.json`.

## Unreleased

### Changed

- Recommend the verified community source `paseo plugin install lyhu/paseo-plugin-tunnel`; retain the full URL with `--ref main` and document branch/tag/commit selection.
- Explain installation stalls after the trust notice and how to check GitHub/npm connectivity and daemon-side proxy configuration.
- Streamline the Agent installation prompt across English and Chinese documentation into a structured, concise execution checklist.
- Refactor and standardize project documentation (design, verification, benchmark, and installation guides) for clearer navigation and organization.
- Correct documentation links, installation status checks, cryptographic and forwarded-header descriptions, and the scope of benchmark and verification claims.

## 0.2.0 — 2026-09-05

### Changed

- Prepare up to two single-use encrypted channels per Egress to reduce handshake latency; expire idle channels after 30 seconds without background reconnect loops.
- Slide request and response flow-control windows when the oldest block is acknowledged, reducing streaming stalls while retaining existing limits.
- List unauthenticated access first and select it by default for new Egresses; preserve existing authentication settings.
- Clarify the intended use for approved services on trusted hosts and use friendlier wording across the project documentation.

### Fixed

- Require Git-source and update-command verification in Agent installation prompts; prohibit silent fallback to directory installation.
- Repair lockfile dependency placement for Git installation with npm 10.

### Added

- Document the upper-right Host picker and the complete cross-host Ingress-to-Egress workflow in both README languages.
- Reproducible transport and Anthropic SSE benchmarks with aggregate-only results and a performance report.
- Show the selected management host throughout the UI and clarify remote daemon setup and host-relative target addresses.
- Show the plugin version beside the project link in the management page footer.

## 0.1.1 — 2026-09-05

### Changed

- Rename the plugin runtime ID to `http-tunnel`; existing tunnel configuration and credentials remain at the same path.

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
