# Paseo HTTP Tunnel

[中文文档](docs/README.zh-CN.md) · [Architecture](docs/design.md) · [Installation details](docs/installation.md) · [Changelog](CHANGLOG.md)

Connect an HTTP or HTTPS service you manage to another trusted Paseo host through the Paseo Relay and end-to-end encryption. Manage each connection from the **HTTP Tunnel** entry in Paseo's sidebar.

```text
Client → Egress → Encrypted relay connection → Ingress → HTTP / HTTPS service
```

Ingress runs on the host that can reach your service. Egress provides a controlled access point on another host you manage. A **Route Offer** connects the two installations without requiring both hosts to be open in the UI at the same time.

Built for [Paseo](https://paseo.sh/) · [Official Paseo repository](https://github.com/getpaseo/paseo)

## Capabilities

- Stream HTTP requests, responses, binary bodies, and server-sent events (SSE).
- Choose local-only access or authenticate callers with an Access Token or Bearer Token; preserve upstream API authentication in Access Token mode.
- Manage listeners, rotate credentials, and import or replace Route Offers per host.
- Generate copyable curl commands and test requests from the Egress host.
- Follow Paseo's theme and language settings across nine supported languages.

The plugin runs in a dedicated Node.js subprocess. Traffic continues while the Paseo app is closed, as long as the host daemon remains running.

## Install

On each Ingress and Egress host, use a Paseo installation that supports **Git plugin sources and manifest build commands**. This workflow is verified with the bundled Paseo CLI and daemon 0.7.2. Git, Node.js 22+, and npm must be available to the daemon process, with access to GitHub and the npm registry. If installation stops after the trust notice, see [network troubleshooting](docs/installation.md#troubleshooting).

```bash
paseo plugin install lyhu/paseo-plugin-tunnel
paseo plugin ls
paseo plugin status http-tunnel --json
```

The community source `lyhu/paseo-plugin-tunnel` expands to this GitHub repository and follows its default branch, currently `main`. To select a branch explicitly, use the full URL as an alternative:

```bash
paseo plugin install https://github.com/lyhu/paseo-plugin-tunnel --ref main
```

Both source forms accept `--ref <branch-or-tag-or-commit>`. The official-plugin shorthand `tunnel` does not identify this community repository.

Confirm `source: "git"` and `ref: "main"` in the status output. A running plugin installed from a local checkout is a directory source, even if that checkout contains `.git`; `paseo plugin update` cannot update directory sources.

Enable plugins in **Settings → Plugins** if needed. Paseo loads plugins as trusted host extensions: backend code and installation commands run with the daemon user's permissions, and the UI runs inside Paseo. Review the source and install it only on hosts you administer. Private repositories require Git credentials on the daemon host.

**No precompiled release or npm publication is required.** Paseo clones the source, runs the manifest's dependency installation command, then compiles the server and client from `index.ts`. You do not need to run `npm run build`, upload `dist`, or download a release asset. See [installation details](docs/installation.md) for pinned revisions and local development.

## Use HTTP Tunnel

Use your local Paseo UI to manage connected hosts, including remote hosts running only the daemon. Install and enable `http-tunnel` on each host first.

The **Host picker is in the upper-right corner of the HTTP Tunnel page**. When multiple connected hosts have the plugin installed, open this picker to switch the host currently being managed. The Ingresses, Egresses, forms, status checks, and quick tests shown on the page all belong to the selected host. Switching the Host picker changes the RPC destination; it does not copy rules between hosts. If the picker contains only one host, verify that the other host is connected and has `http-tunnel` installed and running. See [remote host setup](docs/installation.md#remote-hosts).

1. **Step 1 (Select Service Host)**: Open **HTTP Tunnel** from Paseo's left sidebar. In the **upper-right Host picker**, select the machine that can reach the private service.
2. **Step 2 (Add Ingress)**: Select **Add ingress**. Enter a name and an origin reachable from the selected host, such as `http://127.0.0.1:3000` (where `127.0.0.1` refers to the selected host). An origin contains only a scheme, hostname, and optional port.
3. **Step 3 (Copy Route Offer)**: Select **Copy Route Offer** to copy the complete JSON configuration (preview is masked). Share this sensitive connection configuration securely with the target Egress host administrator.
4. **Step 4 (Import to Egress)**: Switch the **upper-right Host picker** to the Egress machine. Select **Add egress**, paste the offer, and configure the listener binding and authentication mode. When using authentication, save the Access Token shown once after creation.
5. **Step 5 (Verify & Invoke)**: Expand **curl / Quick test** under the Egress to copy the generated command or verify the route directly from the selected Egress host.

Listeners default to `127.0.0.1`, which keeps access on the Egress host. Choose **All network interfaces** only for an approved network where other clients need access, and apply the host firewall and access policy you normally use for that service. For an Internet-facing endpoint, terminate HTTPS at a reverse proxy in front of Egress.

### Authentication

| Mode | Caller credential | Forwarding behavior |
| --- | --- | --- |
| None — default | No plugin credential | Access is governed by the listener binding and surrounding network controls. |
| Header | `X-Paseo-Access-Token: <token>` | Removes the tunnel token; preserves the API's `Authorization` header. |
| Bearer | `Authorization: Bearer <token>` | Removes `Authorization` after validating the tunnel token. |

Use Header mode when the private API requires its own Bearer Token:

```bash
curl 'https://egress.example.com/api/health' \
  --header 'X-Paseo-Access-Token: <ACCESS_TOKEN>' \
  --header 'Authorization: Bearer <API_TOKEN>'
```

Route Offers and Access Tokens are independent credentials. Rotating an Ingress secret invalidates every existing offer for that route; distribute a new offer to each Egress. Rotating an Egress token requires callers to update their token.

## Connection status

Each rule has a status dot. **Green** means HTTP reachability was verified; **yellow** means offline, disabled, or still checking.

- Ingress requires an active Relay connection and an HTTP response from its target origin.
- Egress requires a running listener and an HTTP response through Relay, E2EE, and the imported Route Offer.

While a page is polling the host, checks send `HEAD /` without API credentials approximately every 15 seconds. Checks time out after 8 seconds, do not follow redirects, and stop at response headers. Results are shared between viewers, with at most four checks in flight. Changes invalidate old results; host failures and stale results cannot remain green.

Any upstream HTTP response, including 401, 404, or 5xx, proves connectivity. The displayed HTTP status is not a claim that API authentication or business operations succeed. Public DNS, inbound firewall rules, and the external reverse proxy are outside this check; use the request panel to test an API operation.

## Verify requests

Open **curl / Quick test** under an Egress. Choose GET or POST, set the path and query, and provide a JSON body when needed. The panel generates a POSIX-shell curl command with the headers required by the selected authentication mode.

Newly generated tokens are available in the current page's memory. For an existing rule, paste the token or rotate it. Without a token, curl contains an `<ACCESS_TOKEN>` placeholder and the test action is disabled.

**Send test request** calls the listener through loopback on the Egress host and reports the HTTP status, duration, content type, and response preview. It does not test public DNS, firewall rules, or an external HTTPS reverse proxy. The request origin field affects the curl command only.

Tests time out after 10 seconds, do not follow redirects, and retain at most 8 KiB of response data. SSE previews stop after the first data chunk. Input tokens echoed verbatim by the service are redacted from the preview.

## Operate and update

```bash
paseo plugin status http-tunnel
paseo plugin update http-tunnel
paseo plugin logs http-tunnel
```

Git installations following `main` receive updates through `plugin update`. Use `--ref <tag-or-commit>` at installation to pin a reviewed revision. `plugin reload http-tunnel` reloads the installed source without fetching Git changes. Reloading or updating can interrupt active tunnel requests; neither requires restarting the main Paseo daemon.

Configuration is stored independently in `$PASEO_HOME/tunnel/config.json`, or `~/.paseo/tunnel/config.json` when `PASEO_HOME` is unset. Access Tokens are stored as hashes; the file contains private route credentials and must remain private. The default Relay is `relay.paseo.sh:443` over TLS. For a self-hosted Relay, see [Relay configuration](docs/installation.md#relay-configuration).

## Install with an agent

Copy this prompt into an agent running on the intended Paseo host:

```text
Install and enable the trusted plugin `lyhu/paseo-plugin-tunnel` on this Paseo host (authorized to run with daemon permissions).

### Execution Instructions
1. **Pre-flight Checks**:
   - Check Paseo CLI, target daemon, Git, Node.js 22+, npm, and GitHub/npm connectivity.
   - Confirm Git source and --ref support; read README and paseo-plugin.json before installation.
   - Inspect existing plugins: if already installed, retain existing rules/credentials and report current status without overwriting.
2. **Installation**:
   - Enable plugin support through the target host’s Settings → Plugins if needed.
   - Run: `paseo plugin install lyhu/paseo-plugin-tunnel`
   - Must install directly via the Git source (owner/repo). Do not clone locally, register directory sources, or patch lockfiles.
   - If installation or dependency setup fails, report the redacted error and stop; do not fallback to directory installation.
3. **Verification** (all must pass):
   - `paseo plugin ls --json`: reports `http-tunnel` as `running`.
   - `paseo plugin status http-tunnel --json`: verify `source=git`, `ref=main`, expected repository, and `currentCommit`.
   - `paseo plugin update http-tunnel`: update check succeeds.
4. **Guardrails & Reporting**:
   - Inspect `paseo plugin logs http-tunnel` for troubleshooting; never expose credentials.
   - Do not restart the main daemon, create tunnel rules, bind public ports, or build/publish artifacts.
   - Ask only if host access or credentials are fundamentally missing. Report host, source, ref, installed commit, and update check result upon completion.
```

## Intended use and technical scope

HTTP Tunnel is designed for development services, internal APIs, dashboards, model endpoints, and other approved operational workflows between trusted Paseo hosts. Deploy it only with hosts, services, networks, and data you own or are authorized to administer.

### ✅ Supported Capabilities
- **HTTP/1.1 Forwarding**: Supports standard HTTP methods, paths, query strings, repeated response headers, streaming upload/download, and Server-Sent Events (SSE).
- **Target HTTPS**: Upstream target services support HTTPS with strict public/custom CA certificate validation.
- **Auto Recovery**: Ingress automatically reconnects if the Relay connection drops; reloads restore persisted rules automatically.

### ❌ Unsupported Capabilities
- **Non-HTTP Traffic**: No arbitrary TCP port forwarding, UDP forwarding, or raw socket proxying.
- **Protocol Extensions**: No `CONNECT` tunneling, `WebSocket Upgrade`, or HTTP trailers.
- **Complex Routing**: No multi-target path/host routing on a single listener, load balancing, or automatic request retries.

### 🛡️ Guardrails and Resource Limits
- **Flow Control**: Bidirectional $8 \times 64\text{ KiB}$ sliding window; advances upon oldest block ACK to avoid transfer pauses.
- **Resource Quotas**: Up to 128 active data channels per runtime; up to 256 concurrent HTTP sockets per Egress with a 10s header timeout.
- **Security Boundary**: Egress provides a plaintext HTTP listener, bound to loopback by default. For Internet-facing endpoints, terminate HTTPS at an external reverse proxy (Nginx, Caddy, etc.); end-to-end encryption secures the transport between Egress and Ingress.

For development, clone the repository, run `npm ci`, then use `npm run typecheck`, `npm run lint`, and `npm run build`. Run tests by file with `npm run test:file -- <test-file>`. See [benchmark methodology and results](docs/benchmark.md), [architecture](docs/design.md) and [verification coverage](VERIFICATION.md). Desktop and browser workflows are verified; iOS and Android require device validation.

## License

[AGPL-3.0-only](LICENSE). Includes HTTP tunnel components derived from Paseo.
