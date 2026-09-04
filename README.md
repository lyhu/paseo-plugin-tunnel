# Paseo HTTP Tunnel

[中文文档](docs/README.zh-CN.md) · [Architecture](docs/design.md) · [Installation details](docs/installation.md) · [Changelog](CHANGLOG.md)

Expose a private HTTP service through an Egress host using Paseo's relay network and end-to-end encryption. Manage tunnels from the **HTTP Tunnel** entry in Paseo's sidebar.

```text
Client → Egress → Encrypted relay connection → Ingress → HTTP / HTTPS service
```

Ingress runs on a machine that can reach the private service. Egress runs on a machine that callers can reach. A **Route Offer** connects the two installations without requiring simultaneous access to both hosts during configuration.

## Capabilities

- Stream HTTP requests, responses, binary bodies, and server-sent events (SSE).
- Authenticate callers with an Access Token or Bearer Token; preserve upstream API authentication in Access Token mode.
- Manage listeners, rotate credentials, and import or replace Route Offers per host.
- Generate copyable curl commands and test requests from the Egress host.
- Follow Paseo's theme and language settings across nine supported languages.

The plugin runs in a dedicated Node.js subprocess. Traffic continues while the Paseo app is closed, as long as the host daemon remains running.

## Install

On each Ingress and Egress host, use a Paseo installation that supports **Git plugin sources and manifest build commands**. This workflow is verified with the bundled Paseo CLI and daemon 0.7.2. Git, Node.js 22+, and npm must be available to the daemon process, with access to GitHub and the npm registry.

```bash
paseo plugin install https://github.com/lyhu/paseo-plugin-tunnel --ref main
paseo plugin ls
```

Enable plugins in **Settings → Plugins** if the host's plugin system is disabled. Plugins are trusted, unsandboxed code: the backend and installation commands run on the host, and the UI runs inside Paseo. Private repositories require Git credentials on the daemon host.

**No precompiled release or npm publication is required.** Paseo clones the source, runs the manifest's dependency installation command, then compiles the server and client from `index.ts`. You do not need to run `npm run build`, upload `dist`, or download a release asset. See [installation details](docs/installation.md) for pinned revisions and local development.

## Configure a tunnel

1. **On the Ingress host**, open HTTP Tunnel and select **Add ingress**. Enter a name and the service origin, such as `http://127.0.0.1:3000`. An origin contains only a scheme, hostname, and optional port.
2. Select **Copy Route Offer**. The preview masks the middle of `relayEndpoint`, `tunnelPublicKeyB64`, and `routeSecret`; the Copy button copies the complete JSON for import. Transfer it privately: it grants access to this service.
3. **On the Egress host**, select **Add egress**, paste the offer, and configure the listener and authentication. Save the generated Access Token before closing the result.

Listeners default to `127.0.0.1`. Choose **All network interfaces** only when other machines need access, and configure the host firewall accordingly. For public access, terminate HTTPS at a reverse proxy in front of Egress.

### Authentication

| Mode | Caller credential | Forwarding behavior |
| --- | --- | --- |
| Header — default | `X-Paseo-Access-Token: <token>` | Removes the tunnel token; preserves the API's `Authorization` header. |
| Bearer | `Authorization: Bearer <token>` | Removes `Authorization` after validating the tunnel token. |
| None | No tunnel credential | Anyone who can reach the listener can use it. |

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
paseo plugin status tunnel
paseo plugin update tunnel
paseo plugin logs tunnel
```

Git installations following `main` receive updates through `plugin update`. Use `--ref <tag-or-commit>` at installation to pin a reviewed revision. `plugin reload tunnel` reloads the installed source without fetching Git changes. Reloading or updating can interrupt active tunnel requests; neither requires restarting the main Paseo daemon.

Configuration is stored independently in `$PASEO_HOME/tunnel/config.json`, or `~/.paseo/tunnel/config.json` when `PASEO_HOME` is unset. Access Tokens are stored as hashes; the file contains private route credentials and must remain private. The default Relay is `relay.paseo.sh:443` over TLS. For a self-hosted Relay, see [Relay configuration](docs/installation.md#relay-configuration).

## Install with an agent

Copy this prompt into an agent running on the intended Paseo host:

```text
Install https://github.com/lyhu/paseo-plugin-tunnel on this Paseo host.
I authorize installing and enabling this trusted, unsandboxed plugin.

Check the Paseo CLI and target daemon, Git, Node.js 22+, npm, and GitHub access.
Confirm that `paseo plugin install --help` supports Git sources and --ref.
Read the repository README and paseo-plugin.json before installation.
Inspect existing plugins; preserve existing Tunnel rules and credentials, and
report an existing installation instead of replacing it automatically.
For a new installation, run:
  paseo plugin install https://github.com/lyhu/paseo-plugin-tunnel --ref main
Enable the plugin system if needed using Paseo's supported settings.
Verify that `paseo plugin ls --json` reports tunnel as running; inspect
`paseo plugin logs tunnel` if it fails. Report the host and installed revision.
Do not restart the main daemon, expose a public listener, create tunnel rules,
print credentials, publish npm packages, or build/upload dist artifacts.
If host selection, authentication, or access is missing, ask only for that input.
```

## Scope and development

The Egress listener serves HTTP/1.1. HTTPS is supported for the private target and through an external reverse proxy for public callers. CONNECT, WebSocket Upgrade, HTTP trailers, arbitrary TCP forwarding, load balancing, and automatic request retries are not supported. The connectivity dot reports transport reachability; it does not replace an application health endpoint.

For development, clone the repository, run `npm ci`, then use `npm run typecheck`, `npm run lint`, and `npm run build`. Run tests by file with `npm run test:file -- <test-file>`. See [architecture](docs/design.md) and [verification coverage](VERIFICATION.md). Desktop and browser workflows are verified; iOS and Android require device validation.

## License

[AGPL-3.0-only](LICENSE). Includes HTTP tunnel components derived from Paseo.
