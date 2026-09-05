# Paseo HTTP Tunnel

[English](../README.md) · [设计文档](design.md) · [安装说明](installation.md) · [更新日志](../CHANGLOG.md)

独立的 Paseo HTTP 服务代理插件。内网机器运行 Ingress，公网机器运行 Egress，通过 Relay 和端到端加密通道转发 HTTP 请求。

```text
HTTP 调用方 → Egress → Relay（加密数据）→ Ingress → 内网 HTTP / HTTPS 服务
```

插件在左侧主导航提供 **HTTP Tunnel**（Network 图标），每个页面只操作所选 Host。两台 Host 之间通过 Route Offer 复制 / 导入配置，无需跨 Host RPC。

## 安装

在每台 Ingress 和 Egress 主机安装插件。要求 Paseo 支持 **Git 来源和插件清单 build 命令**，已验证宿主为桌面发行包内的 Paseo CLI / daemon 0.7.2。daemon 进程需要能够调用 Git、Node.js 22+ 和 npm，并访问 GitHub 与 npm registry。

```bash
paseo plugin install https://github.com/lyhu/paseo-plugin-tunnel --ref main
paseo plugin ls
```

如宿主插件系统未开启，在 **Settings → Plugins** 启用。插件属于受信任、未沙箱化代码：服务端及安装命令在 Host 上执行，客户端贡献在 Paseo 内运行。私有仓库需要 daemon 所在机器具备 Git 访问凭据。

**不需要预编译、发布 npm 包或上传 Release 附件。** Paseo 克隆源码后，根据 `paseo-plugin.json` 执行运行依赖安装，再编译 `index.ts` 的前后端贡献。`dist` 不是安装入口，用户无需执行 `npm run build`。固定版本与目录安装见 [安装说明](installation.md)。

跟随 `main` 的 Git 安装使用以下命令检查和更新：

```bash
paseo plugin status http-tunnel
paseo plugin update http-tunnel
paseo plugin logs http-tunnel
```

`paseo plugin reload http-tunnel` 只重载当前源码，不拉取 Git 更新。更新或重载会中断活动 Tunnel 请求，但不需要重启主 daemon。可在安装时使用 `--ref <tag-or-commit>` 固定已审阅版本。

## 三步配置

在本地 Paseo UI 中即可管理已连接的远程 Host，远程只需运行 daemon。先在各 Host 安装并启用 `http-tunnel`；当多个 Host 提供该插件时，页面顶部会出现 Host 切换器。选中 Host 后，操作通过其已有的 Paseo 连接发送，可经 Relay 到达远程。详见[远程 Host 安装](installation.md#remote-hosts)。

1. **选择 Ingress Host**：打开 HTTP Tunnel，选择 **Add Ingress**，填写名称和该 Host 可访问的服务 Origin，例如 `http://127.0.0.1:3000`。此处 `127.0.0.1` 指选中的 Host。Origin 只包含协议、主机和端口。
2. 点击 **Copy Route Offer**。页面对 `relayEndpoint`、`tunnelPublicKeyB64` 和 `routeSecret` 做中间脱敏；“复制”按钮获取用于导入的完整 JSON。Offer 包含访问密钥，须私下传给 Egress 管理者，它不是加密文件。
3. **切换到 Egress Host**：选择 **Add Egress**，粘贴 Offer，核对来源服务与建议端口，选择监听范围和认证方式。保存后立即展示一次性 Access Token。

创建 Egress 不要求 Ingress 同时在线；实际转发时两端和 Relay 都必须可达。若希望调用方从外部网络连接，监听范围选择 **Network / public**，并配置防火墙和 HTTPS 反向代理。

推荐默认的 **Access token** 模式：

```bash
curl -H 'X-Paseo-Access-Token: YOUR_TOKEN' http://EGRESS_HOST:8080/api/health
```

Bearer 模式使用 `Authorization: Bearer YOUR_TOKEN`。代理认证头不会转发到内网服务；如果后端 API 本身需要 `Authorization`，选择默认的 Access token 模式，以保留后端认证头。

**Manage** 提供编辑、启停、删除、轮换密钥和替换 Offer。轮换 Ingress secret 后，需要在每个 Egress 导入新 Offer；轮换 Egress token 后，调用方需要更新 Token。Token 仅在生成时完整展示，当前页面可临时复用；关闭页面后，丢失的 Token 需重新生成。

## 连通状态

每条 Ingress 和 Egress 显示状态圆点：**绿色**表示已验证 HTTP 链路连通，**黄色**表示离线、停用或检查中。

- Ingress：规则启用、Relay 已连接，且目标 Origin 能返回 HTTP 响应。
- Egress：listener 已启动，通过 Relay、E2EE 与 Route Offer 验证后收到内网服务的 HTTP 响应。

页面轮询 Host 时，约每 15 秒检查一次 `HEAD /`，不携带业务凭据，不跟随重定向，收到响应头即停止，8 秒超时。同一 Host 的结果跨页面共享，同时最多执行 4 个检查；配置变更使旧结果失效，Host 断连或结果过期不会继续显示绿点。

401、404、业务 5xx 等响应也表明 HTTP 链路已连通。圆点旁显示具体 HTTP 状态，但不代表认证通过或业务操作成功，也不覆盖公网 DNS、防火墙和外部反向代理。业务验证请使用下方请求面板。

## curl 与快速验证

在每条 Egress 下打开 **curl / 快速验证**。填写路径、查询参数，选择 GET 或 POST；POST 可填写 JSON 请求体。curl 支持复制，参数使用 POSIX shell 转义。

- **Header**：包含 `X-Paseo-Access-Token`，可同时填写内网 API 的 `Authorization: Bearer`。
- **Bearer**：使用 `Authorization: Bearer` 验证 Egress，不能再用同一请求头携带另一个内网令牌。
- 新生成的 Token 自动填入当前页面。已有规则需要粘贴 Token；未填写时 curl 显示 `<ACCESS_TOKEN>` 占位符，验证按钮不可用。明文不写入配置或浏览器存储。
- 请求源地址用于生成调用方的 curl，可改成公网 HTTPS 地址。**快速验证始终从 Egress Host 请求其本机监听端口**，不验证外部 DNS、TLS 反向代理或防火墙。
- 验证展示 HTTP 状态、耗时、Content-Type 和最多 8 KiB 响应。10 秒超时，不跟随重定向；SSE 收到首块后停止。响应预览替换原样回显的输入令牌。

## 语言

界面跟随 Paseo，覆盖简体中文、英语、日语、韩语、西班牙语、法语、巴西葡萄牙语、俄语和阿拉伯语。HTTP 字段名、Ingress / Egress 和 Route Offer 保留协议名称；服务端诊断信息保持原文。

Paseo 0.7.2 的插件 SDK 没有 locale 接口，因此插件只读 `@paseo:app-settings` 的语言偏好：Web / Electron 使用 localStorage，原生端使用宿主已有的 AsyncStorage 模块。页面打开时每秒检查变更，system 模式按 Paseo 支持的语言顺序解析系统偏好。此适配依赖宿主存储约定，SDK 提供语言接口后应替换；原生端尚未真机验证。

## Relay 与独立存储

默认使用 `relay.paseo.sh:443`，启用 TLS。插件不读取或改写 Paseo 主配置中的 `daemon.tunnel`。

配置保存到 `$PASEO_HOME/tunnel/config.json`，未设置 `PASEO_HOME` 时为 `~/.paseo/tunnel/config.json`。文件权限为 `0600`，通过临时文件和原子重命名更新。状态 RPC 不返回密钥或 Token 哈希。

自建 Relay 时，在首次添加规则前创建配置文件，或在现有文件中**只修改 `relay` 字段，保留其他字段**：

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

`endpoint` 是 Ingress 连接的地址，`publicEndpoint` 写入 Offer，供 Egress 连接。省略 public 字段时使用 Ingress 地址。修改后运行 `paseo plugin reload http-tunnel`；地址改变后需重新导出 / 替换已有 Offer。

安装到多台机器时，各自使用独立配置。在同一个 `PASEO_HOME` 下只安装一个 http-tunnel 实例，避免争用配置和端口。监听端口不得与其他服务冲突。

## 传输与边界

- 支持 HTTP 方法、路径、查询参数、重复响应头、流式上传 / 下载和 SSE；内网目标支持 HTTPS，保持证书验证。
- 每个方向最多 8 个未确认的 64 KiB 数据块，Body 不整体缓存、不落盘。
- 每个 Ingress / Egress 运行时最多 128 个数据连接；Egress 最多 256 个 HTTP socket，未完成请求头限制为 10 秒。
- Egress 提供 HTTP listener。对公网开放时，在它前面部署 HTTPS 反向代理；端到端加密保护的是 Egress 与 Ingress 之间的链路。
- 不支持 CONNECT、WebSocket Upgrade、HTTP trailers 或任意 TCP 代理。
- Relay 断连后 Ingress 自动重连；插件停用 / 重载时关闭监听和连接，重新加载时恢复持久化规则。
- 修改某个 Ingress 的名称不会重建 Relay 控制连接。更换服务或密钥会中断受影响的请求。

## 让 Agent 安装

将以下提示词交给运行在目标 Paseo Host 上的 Agent：

```text
请在当前 Paseo Host 安装 https://github.com/lyhu/paseo-plugin-tunnel。
我授权安装并启用此受信任、未沙箱化插件。

检查 Paseo CLI、目标 daemon、Git、Node.js 22+、npm 和 GitHub 访问能力；
确认 paseo plugin install --help 支持 Git 来源与 --ref。
先阅读仓库 README 和 paseo-plugin.json，再检查已安装插件。
保留已有 Tunnel 规则和凭据；发现同名插件时报告现状，不自动替换。
新安装执行：
  paseo plugin install https://github.com/lyhu/paseo-plugin-tunnel --ref main
如插件系统未开启，使用 Paseo 支持的设置启用。
使用 paseo plugin ls --json 确认 http-tunnel 为 running，失败时查看
paseo plugin logs http-tunnel。完成后报告目标 Host 和安装的 commit。
不要重启主 daemon、创建 Tunnel 规则、开放公网端口、输出凭据、
发布 npm 包，或生成和上传 dist。只有目标 Host、认证或访问权限
不足时，才询问缺失的信息。
```

## 开发与验证

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm run build
```

按文件运行测试，每次一个文件：

```bash
npm run test:file -- src/client/locale.test.ts
npm run test:file -- src/server/request.test.ts
npm run test:file -- src/server/storage.test.ts
npm run test:file -- src/server/tunnel-wire.test.ts
npm run test:file -- src/server/relay-url.test.ts
npm run test:file -- src/server/tunnel.e2e.test.ts
npm run test:file -- src/server/lifecycle.e2e.test.ts
npm run test:file -- src/server/https.e2e.test.ts
```

集成测试在本机 workerd 中运行 `@getpaseo/relay` 的真实 Cloudflare 实现，无需公网 Relay。HTTPS 测试使用 OpenSSL 生成临时证书，并通过独立进程的 `NODE_EXTRA_CA_CERTS` 配置测试 CA。

如果本机有 Paseo 源码及其依赖，还可以启动隔离宿主验证真实插件子进程，或预览原生 UI 的 Web 版本：

```bash
npm run verify:host -- /path/to/paseo
npm run preview -- /path/to/paseo
```

预览地址由命令输出；添加 `?theme=light` 查看浅色主题。预览使用真实临时 Daemon 和插件 RPC，按 Ctrl+C 清理。浏览器预览不替代 iOS / Android 真机验证。

宿主集成脚本需要具备相同插件清单能力的 Paseo 源码及依赖。

下面的命令会在**已安装并启用插件的本地主 Daemon**上创建临时规则、验证实际 Relay 转发并重载 http-tunnel，然后清理自己的规则。运行前确认可以短暂中断此插件已有连接；它不重启 Daemon。

```bash
npm run verify:local -- /path/to/paseo
```

## 排查

- `paseo plugin ls` 检查插件是否 running；`paseo plugin logs http-tunnel` 查看启动错误。
- Relay 一直 connecting：检查 Ingress 的 `relay.endpoint` 是否从该机器可达。某些机器只能访问公网 TLS 入口。
- 401：检查认证模式和 Token；默认头是 `X-Paseo-Access-Token`。
- 502：检查 Ingress 是否在线、目标服务是否运行、Offer 是否仍有效，以及 HTTPS 证书是否可信。
- 端口占用：选择其他监听端口，或停用占用该端口的规则。

## 许可

[AGPL-3.0-only](../LICENSE)。包含派生自 Paseo 的 HTTP Tunnel 组件。
