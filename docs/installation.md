# Installation and Distribution Guide

This document details how to install, configure, verify, and maintain the **Paseo HTTP Tunnel** plugin across local and remote hosts.

---

## 1. Prerequisites and Host Requirements

Before installation, ensure the target host meets the following requirements:

| Component | Requirement | Verification Command | Notes |
| :--- | :--- | :--- | :--- |
| **Paseo CLI & Daemon** | Verified with 0.7.2 | `paseo --version` and `paseo plugin install --help` | Both CLI and daemon must support Git sources and manifest `build` steps. |
| **Node.js** | $\ge 22.0.0$ | `node -v` | Required by the plugin runtime and compile phase. |
| **Git & npm** | Available to the daemon | `git --version && npm -v` | Must be available on the **daemon process's `PATH`**. |
| **Network Access** | Outbound HTTPS | `curl -I https://github.com` | Access to GitHub and `registry.npmjs.org` is required. |

> [!IMPORTANT]
> **Daemon Environment & Security Scope**:
> - Plugins execute trusted JavaScript without an OS-level sandbox, running under the daemon user's host permissions.
> - Git and npm processes are launched directly by the daemon. Environment variables (such as HTTP proxies) must be configured on the daemon service itself, not just in your current interactive shell.
> - Do not embed credentials in Git repository URLs.

---

## 2. Standard Installation (Git Source)

Paseo allows installing plugins directly from community repositories or full Git URLs. No daemon restart is required. Enable plugin support in the target host’s **Settings → Plugins**. Install only one `http-tunnel` instance per `PASEO_HOME`; inspect any existing installation before replacing its source.

### Recommended: Community Source

```bash
# Install the latest version from the main branch
paseo plugin install lyhu/paseo-plugin-tunnel

# Verify plugin status
paseo plugin ls --json
paseo plugin status http-tunnel
```

Paseo resolves `lyhu/paseo-plugin-tunnel` to `https://github.com/lyhu/paseo-plugin-tunnel.git`. When `--ref` is omitted, it automatically tracks the default branch (`main`).

### Alternative: Explicit URL & Pinned Revisions

Use a tag or commit to pin a revision. An explicit branch such as `main` continues to track updates:

```bash
# Pin to a specific release tag
paseo plugin install lyhu/paseo-plugin-tunnel --ref v0.2.0

# Or using the full repository URL
paseo plugin install https://github.com/lyhu/paseo-plugin-tunnel --ref main
```

### Installation Verification

Verify that the plugin is properly registered as a Git source and running:

```bash
# Check runtime state, then Git source details
paseo plugin ls --json
paseo plugin status http-tunnel --json
```

**Success Criteria**:
- `paseo plugin ls --json`: `http-tunnel` has `status: "running"`.
- `paseo plugin status http-tunnel --json`: the following Git source fields match the intended installation:
- `source`: `"git"`
- `ref`: target branch/tag (e.g., `"main"` or `"v0.2.0"`)
- `currentCommit`: valid 40-character Git SHA

---

## 3. Lifecycle and Routine Operations

For installations tracking `main`, routine management can be handled through standard Paseo plugin commands:

| Action | Command | Impact |
| :--- | :--- | :--- |
| **Apply Updates** | `paseo plugin update http-tunnel` | Fetches remote Git changes; when an update is available, runs manifest preparation, compiles, and activates it. Active tunnel requests may be briefly interrupted. |
| **Hot Reload** | `paseo plugin reload http-tunnel` | Re-compiles existing local checkout without fetching from Git. Preserves configurations. |
| **View Logs** | `paseo plugin logs http-tunnel` | Outputs runtime diagnostic logs; inspect and redact sensitive values before sharing. |
| **Disable / Enable** | `paseo plugin disable http-tunnel`<br>`paseo plugin enable http-tunnel` | Stops listeners and background connections; re-enabling restores persisted rules. |

> [!NOTE]
> Neither updates nor reloads require restarting the primary Paseo daemon.

---

<a id="remote-hosts"></a>

## 4. Multi-Host and Remote Deployments

HTTP Tunnel operates across distributed hosts: an **Ingress Host** (exposing local internal services) and an **Egress Host** (listening for client calls).

```text
[ Client ] ──> [ Egress Host (http-tunnel) ] ──(Relay / E2EE)──> [ Ingress Host (http-tunnel) ] ──> [ Target Service ]
```

1. **Install on Both Hosts**: Install `http-tunnel` on both the Ingress and Egress machines under their respective `PASEO_HOME`.
2. **Unified Web/Desktop UI**: In your local Paseo app, connect to the remote host. The top-right **Host Picker** lets you switch active management contexts seamlessly without opening multiple browser windows.
3. **Cross-Host Binding via Route Offer**:
   - On the Ingress host: Add an Ingress rule pointing to the service Origin (e.g., `http://127.0.0.1:3000`), then click **Copy Route Offer**.
   - On the Egress host: Switch the Host Picker, click **Add Egress**, and paste the Route Offer.

---

## 5. Migrating from Legacy Plugin ID (`tunnel` $\rightarrow$ `http-tunnel`)

If a host previously ran the legacy plugin identity `tunnel`, remove it before installing `http-tunnel` to prevent resource and port contention:

```bash
# 1. Remove old plugin registration (persisted configs remain intact)
paseo plugin remove tunnel

# 2. Install the new verified identity
paseo plugin install lyhu/paseo-plugin-tunnel

# 3. Verify status
paseo plugin status http-tunnel
```

Removing the old registration leaves `$PASEO_HOME/tunnel/config.json` intact. The new `http-tunnel` identity automatically reuses existing rules, cryptographic keys, and credentials.

---

## 6. How Compilation & Dependencies Work

The Git repository itself is the deployable artifact. You do not need a precompiled release, a published npm package for this plugin, or a `dist/` bundle. Installation still downloads the runtime dependencies from npm.

In `paseo-plugin.json`:
```json
{
  "id": "http-tunnel",
  "build": [
    ["npm", "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]
  ]
}
```

During Git installation:
1. Paseo clones the designated commit into an isolated runtime directory.
2. Paseo executes the manifest's `build` commands to install locked runtime dependencies (`package-lock.json`).
3. Paseo's built-in bundler compiles `index.ts` (server runtime and client UI contributions) against the Paseo Plugin SDK.
4. The background daemon launches the isolated Node.js plugin child process.

---

## 7. Local Directory Installation (for Developers)

To test local changes or contribute to HTTP Tunnel:

```bash
git clone https://github.com/lyhu/paseo-plugin-tunnel.git
cd paseo-plugin-tunnel

# Install dependencies and run quality checks
npm ci
npm run typecheck
npm run lint

# Link local directory into Paseo
paseo plugin install "$PWD"
```

After modifying code in your local checkout:
```bash
npm run typecheck
paseo plugin reload http-tunnel
```

> [!WARNING]
> Directory installations cannot be updated via `paseo plugin update`. Updates must be applied using `git pull --ff-only` and `npm ci` inside the repository.

---

<a id="relay-configuration"></a>

## 8. Custom Relay Configuration

By default, HTTP Tunnel connects to `relay.paseo.sh:443` over TLS. To use a self-hosted or private Relay, update `$PASEO_HOME/tunnel/config.json` (or `~/.paseo/tunnel/config.json`). In an existing file, change only the `relay` field and preserve identity, rules, and credentials:

```json
{
  "relay": {
    "endpoint": "relay.internal.net:443",
    "useTls": true,
    "publicEndpoint": "relay.internal.net:443",
    "publicUseTls": true
  }
}
```

- `endpoint`: Internal address used by Ingress to establish the control channel.
- `publicEndpoint`: Address embedded in exported Route Offers, reachable from Egress; it need not be publicly accessible. When omitted, the Ingress endpoint is used.
- Permissions: Ensure the configuration file mode is set to `0600`.
- Reload: Run `paseo plugin reload http-tunnel` after configuration edits, then regenerate/re-import affected Route Offers.

---

<a id="troubleshooting"></a>

## 9. Troubleshooting & Diagnostics

### Pre-installation Network Check

`Trusting plugin code` is an informational notice, not a stuck prompt. If installation hangs during Git clone or npm install, test connectivity directly on the daemon host:

```bash
# Check GitHub reachability
git ls-remote https://github.com/lyhu/paseo-plugin-tunnel.git HEAD

# Check npm registry reachability
curl -I --connect-timeout 5 --max-time 10 https://registry.npmjs.org
```

If the host cannot reach GitHub or npm, neither the short source nor `--ref main` can complete an online installation. An offline host needs separately prepared source and dependencies. Inspect the daemon log for failed Git or manifest commands.

### Common Symptoms & Solutions

| Symptom | Probable Cause | Corrective Action |
| :--- | :--- | :--- |
| **Git source rejected** | Outdated CLI/daemon | Use a CLI and daemon that support Git sources and manifest build commands (verified with 0.7.2). |
| **Git clone hangs / fails** | Network/proxy or missing credentials | Configure daemon-level proxy or verify SSH/HTTPS Git access on the host. |
| **`npm` not found** | Incomplete `PATH` in daemon service | Ensure Node 22+ and npm are in the system/service manager `PATH`. |
| **Sidebar icon missing** | Host plugin switch disabled | Go to **Settings → Plugins** in Paseo to enable plugin support. |
| **HTTP 401 Unauthorized** | Token mismatch or incorrect mode | Verify whether Egress expects `X-Paseo-Access-Token` or Bearer token. |
| **HTTP 502 Bad Gateway** | Relay unreachable or Ingress offline | Check Ingress connectivity, Relay network reachability, and Origin service health. |
| **Port bind error** | Port conflict | Choose an unused port or terminate competing processes. |
