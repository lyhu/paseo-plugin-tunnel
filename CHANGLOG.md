# Changelog

User-visible changes to Paseo HTTP Tunnel. Versions follow Semantic Versioning; the current source version is defined in `package.json`.

## Unreleased

### Changed

- Upgrade the Paseo plugin SDK and `@getpaseo/relay` to `0.10.3`, and raise `requirements.paseo` to `>=0.10.3`. Hosts on Paseo 0.8–0.10.2 are now rejected by the manifest's version requirement and must upgrade before installing or updating the plugin.
- Document the raised host floor and the matching HTTP Tunnel 0.3.3 release across `README.md`, `docs/README.zh-CN.md`, and `docs/installation.md`.

### Fixed

- Pass the new `{ target: { kind: "endpoint", host } }` argument shape to `connectToDaemon` in `scripts/verify-local.mjs`, matching the Paseo 0.10.3 client API.

### Added

- Add `index.client.test.ts`, covering the client contribution contract (contribution id shape, sidebar item, and surface registration) that Paseo validates at load time.

## 0.3.2 — 2026-10-06

### Added

- Publish the plugin to npm as `paseo-plugin-tunnel`, so Paseo 0.9 and newer install it with `paseo plugin install npm:paseo-plugin-tunnel`. Paseo 0.8 continues to install from GitHub.
- Declare `files`, `author`, `repository`, `bugs`, `homepage`, and `keywords` in `package.json` so the published package carries the metadata the Paseo registry listing reads.
- Add an `npm test` script that runs the vitest suites, plus a `test:benchmark` script for the `node:test` benchmark parser test, so the two test frameworks no longer collide when vitest collects `benchmark/`.

### Fixed

- Track the lockfile as `npm-shrinkwrap.json` instead of `package-lock.json`. npm never includes `package-lock.json` in a published tarball, so the manifest's `npm ci` build command failed on every npm install; npm does ship `npm-shrinkwrap.json`, so Git and npm installs now resolve the same pinned versions.

### Changed

- Document installing on daemon hosts that can reach the npm registry but not `github.com`: a repository-scoped Git mirror rewrite, or an offline directory install.
- Document that the manifest `build` runs on Git and npm installs but not on directory installs.

## 0.3.1 — 2026-09-12

### Fixed

- Regenerate `package-lock.json` with npm 10 so the platform-specific optional esbuild binaries are recorded again. npm 10 hosts rejected the manifest `npm ci` with "can only install packages when your package.json and package-lock.json are in sync", which blocked Git installs and updates on those hosts.

### Changed

- Document that the Host Picker only appears while at least two connected hosts load this plugin's client contributions, so every managed host must run HTTP Tunnel 0.3.1 or later after a Paseo 0.8 upgrade.

## 0.3.0 — 2026-09-11

### Added

- Declare `requirements.paseo: ">=0.8.0"` in `paseo-plugin.json`, so Paseo 0.7.x rejects the plugin with the new upgrade diagnostic instead of loading it.

### Changed

- Migrate to the Paseo 0.8 plugin runtime: split the root `index.ts` entry into `index.client.tsx` and `index.server.ts`, move modules into `client/`, `server/`, and `shared/`, and drop the `*.client` / `*.server` / `*.shared` filename suffixes.
- Import RPC contracts and schemas (`defineRpc`) from the runtime-neutral `@getpaseo/plugin` root and client hooks and props (`useRpc`, `PluginSurfaceProps`) from `@getpaseo/plugin/client`.
- Confine browser globals to `client/web.ts` with `Platform.OS` gating and drop the DOM lib from the typecheck configuration.
- Upgrade the Paseo runtime and SDK dependencies to `@getpaseo/{plugin,client,relay}@0.8.0` and require Paseo CLI and daemon 0.8.0 or newer.
- Recommend the verified community source `paseo plugin install lyhu/paseo-plugin-tunnel`; retain the full URL with `--ref main` and document branch/tag/commit selection.
- Explain installation stalls after the trust notice and how to check GitHub/npm connectivity and daemon-side proxy configuration.
- Streamline the Agent installation prompt across English and Chinese documentation into a structured, concise execution checklist.
- Refactor and standardize project documentation (design, verification, benchmark, and installation guides) for clearer navigation and organization.
- Correct documentation links, installation status checks, cryptographic and forwarded-header descriptions, and the scope of benchmark and verification claims.

### Removed

- Delete the hand-written `paseo-plugin.d.ts` SDK shim; Paseo 0.8 ships its own plugin types.

### Fixed

- Mirror the packaged version in `shared/version.ts` instead of importing the root `package.json`; Paseo 0.8 rejects any bundle that resolves a module at the plugin root.

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
