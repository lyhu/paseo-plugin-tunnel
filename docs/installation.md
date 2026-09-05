# Installation and distribution

## Host requirements

Use Paseo with Git-source plugin installation and manifest `build` support. The workflow is verified with the bundled Paseo CLI and daemon 0.7.2. Check `paseo plugin install --help` for a Git `source` and `--ref`; the target daemon must support the same functionality.

Git, Node.js 22+, and npm must be on the daemon process's PATH. GitHub and npm registry access are required during Git installation and updates. Repository authentication belongs to the daemon host, including when installation is requested through a remote client. Do not embed credentials in repository URLs.

Plugins execute trusted code without a sandbox. Enable the plugin system in Paseo's host settings. Plugin installation and updates do not require a main daemon restart.

## Git installation

```bash
paseo plugin install https://github.com/lyhu/paseo-plugin-tunnel --ref main
paseo plugin ls --json
paseo plugin status http-tunnel
```

The runtime ID is `http-tunnel`. Install one instance per `PASEO_HOME`, because configuration and listener ports are shared within that home. If it is already installed, inspect the source before choosing an update or a local reload; do not overwrite an existing installation to change its source.

To pin a reviewed revision, replace `main` with an existing tag or commit:

```bash
paseo plugin install https://github.com/lyhu/paseo-plugin-tunnel --ref <tag-or-commit>
```

`main` tracks the branch for `paseo plugin update http-tunnel`. Tags and commits are pinned. `paseo plugin reload http-tunnel` recompiles the currently installed source without fetching from Git. Updates and reloads can interrupt active requests.

## Rename an existing installation

If the host already lists `tunnel`, remove that registration before installing `http-tunnel` to avoid sharing listeners between two plugin processes:

```bash
paseo plugin remove tunnel
paseo plugin install https://github.com/lyhu/paseo-plugin-tunnel --ref main
paseo plugin status http-tunnel
```

For a directory source, reinstall the same checkout path instead of the Git URL. Removing the registration leaves `$PASEO_HOME/tunnel/config.json` intact. The new ID reuses existing rules, identity, and credentials. Active tunnel requests are interrupted during the switch.

## Dependency preparation and compilation

The repository is the distributable artifact. Commit the manifest, `index.ts`, imported source files, `package.json`, and `package-lock.json`.

The manifest declares:

```json
{
  "id": "http-tunnel",
  "build": [
    ["npm", "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"]
  ]
}
```

For Git installation and updates, Paseo checks out the selected revision, executes these commands in the plugin directory, compiles the server and client contributions, and starts the plugin. This command installs locked runtime dependencies; it does not generate a release bundle. The current runtime dependencies do not require npm lifecycle scripts.

Paseo supplies the plugin SDK and shared UI runtime. Its compiler bundles the server's Relay and WebSocket dependencies from the installed packages. No npm publication, precompiled `dist`, GitHub Release asset, or separate application build is required. `npm run build` is a developer check for dependency resolution and runtime boundaries.

A complete source checkout without `node_modules` or `dist` has been verified through Paseo's Git installation path: the manifest installs dependencies, compilation succeeds, and the plugin reports `source: git` and `status: running`. This check uses an isolated daemon home so production rules and listeners remain untouched.

## Directory installation for development

Directory sources use dependencies you install yourself. Keep the checkout at a stable path on the daemon host:

```bash
git clone https://github.com/lyhu/paseo-plugin-tunnel.git
cd paseo-plugin-tunnel
npm ci
npm run typecheck
npm run lint
paseo plugin install "$PWD"
```

After editing source, run the checks and `paseo plugin reload http-tunnel`. Do not install `dist` or treat a directory source as Git-managed. Use `git pull --ff-only` and `npm ci` in your checkout when updating a directory installation.

## Relay configuration

The default Relay is `relay.paseo.sh:443` with TLS. The plugin stores its own configuration at `$PASEO_HOME/tunnel/config.json`, defaulting to `~/.paseo/tunnel/config.json`.

For a self-hosted Relay, set the following `relay` object. In an existing configuration, preserve identity, Ingresses, Egresses, and all other fields:

```json
{
  "relay": {
    "endpoint": "relay.example.com:443",
    "useTls": true,
    "publicEndpoint": "relay.example.com:443",
    "publicUseTls": true
  }
}
```

`endpoint` is used by Ingress. The public endpoint is embedded in exported Route Offers for Egress; omitted public fields default to the Ingress endpoint. Reload the plugin after changing configuration, then export and replace affected Offers. Keep the configuration file private with mode `0600`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Git source or `build` rejected | CLI and target daemon both support Git plugin sources and manifest preparation. |
| Git clone fails | Repository visibility and Git credentials on the daemon host. |
| `npm` not found or installation fails | Daemon PATH, Node version, registry access, and installation output. |
| Plugin is disabled or sidebar entry is absent | Host plugin switch, plugin status, and the currently selected Host. |
| Runtime or compilation failure | `paseo plugin logs http-tunnel`; correct the cause before reloading. |
| HTTP 401 | Listener authentication mode and caller Token. |
| HTTP 502 | Relay connectivity, valid Route Offer, and upstream service availability. |
| Listener cannot bind | Port availability and operating-system bind permissions. |
