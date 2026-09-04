# paseo-plugin-tunnel

独立的 Paseo HTTP 服务代理插件。内网机器运行 Ingress，公网机器运行 Egress，通过 Relay 和端到端加密通道转发 HTTP 请求。

```text
HTTP 调用方 → Egress → Relay（加密数据）→ Ingress → 内网 HTTP / HTTPS 服务
```

插件在左侧主导航提供 **HTTP Tunnel**（Network 图标），每个页面只操作所选 Host。两台 Host 之间通过 Route Offer 复制 / 导入配置，无需跨 Host RPC。

## 安装

要求 Node.js 22+、支持本地插件的 Paseo。已在本地安装的 **Paseo 0.7.2** 验证。

在每台需要代理的机器上：

```bash
cd /absolute/path/to/paseo-plugin-tunnel
npm ci
npm run typecheck
npm run build
paseo plugin install /absolute/path/to/paseo-plugin-tunnel
paseo plugin ls
```

在 Paseo **Settings → Plugins** 开启插件。插件代码受信任、未沙箱化：服务端运行在独立 Node 子进程，拥有宿主机器访问权限。

源码更新后执行：

```bash
npm ci
npm run typecheck
paseo plugin reload tunnel
```

Paseo 在安装 / 重载时编译 `index.ts`，分别生成前后端 bundle。`npm run build` 检查依赖和运行时边界；安装路径应指向源码目录，而非 `dist`。开发用 SDK 依赖和 `paseo-plugin.d.ts` 提供类型，实际 SDK 运行时由宿主注入。

## 三步配置

1. **Ingress Host**：打开 HTTP Tunnel，选择 **Add Ingress**，填写名称和内网服务 Origin，例如 `http://127.0.0.1:3000`。Origin 只包含协议、主机和端口。
2. 点击 **Copy Route Offer**。Offer 是包含访问密钥的 JSON，须私下传给 Egress 管理者。它不是加密文件。
3. **Egress Host**：打开 HTTP Tunnel，选择 **Add Egress**，粘贴 Offer，核对来源服务与建议端口，选择监听范围和认证方式。保存后立即展示一次性 Access Token。

创建 Egress 不要求 Ingress 同时在线；实际转发时两端和 Relay 都必须可达。若希望调用方从外部网络连接，监听范围选择 **Network / public**，并配置防火墙和 HTTPS 反向代理。

推荐默认的 **Access token** 模式：

```bash
curl -H 'X-Paseo-Access-Token: YOUR_TOKEN' http://EGRESS_HOST:8080/api/health
```

Bearer 模式使用 `Authorization: Bearer YOUR_TOKEN`。代理认证头不会转发到内网服务；如果后端 API 本身需要 `Authorization`，选择默认的 Access token 模式，以保留后端认证头。

**Manage / Manage listener** 提供编辑、启停、删除、轮换密钥和替换 Offer。轮换 Ingress secret 后，需要在每个 Egress 导入新 Offer；轮换 Egress token 后，调用方需要更新 Token。Token 仅在生成时完整展示，当前页面可临时复用；关闭页面后，丢失的 Token 需重新生成。

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

`endpoint` 是 Ingress 连接的地址，`publicEndpoint` 写入 Offer，供 Egress 连接。省略 public 字段时使用 Ingress 地址。修改后运行 `paseo plugin reload tunnel`；地址改变后需重新导出 / 替换已有 Offer。

安装到多台机器时，各自使用独立配置。在同一个 `PASEO_HOME` 下只安装一个 tunnel 实例，避免争用配置和端口。此版本不自动迁移旧版内置 Tunnel 规则；切换旧规则前先停用旧监听，避免端口冲突。

## 传输与边界

- 支持 HTTP 方法、路径、查询参数、重复响应头、流式上传 / 下载和 SSE；内网目标支持 HTTPS，保持证书验证。
- 每个方向最多 8 个未确认的 64 KiB 数据块，Body 不整体缓存、不落盘。
- 每个 Ingress / Egress 运行时最多 128 个数据连接；Egress 最多 256 个 HTTP socket，未完成请求头限制为 10 秒。
- Egress 提供 HTTP listener。对公网开放时，在它前面部署 HTTPS 反向代理；端到端加密保护的是 Egress 与 Ingress 之间的链路。
- 不支持 CONNECT、WebSocket Upgrade、HTTP trailers 或任意 TCP 代理。
- Relay 断连后 Ingress 自动重连；插件停用 / 重载时关闭监听和连接，重新加载时恢复持久化规则。
- 修改某个 Ingress 的名称不会重建 Relay 控制连接。更换服务或密钥会中断受影响的请求。

## 开发与验证

```bash
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

下面的命令会在**已安装并启用插件的本地主 Daemon**上创建临时规则、验证实际 Relay 转发并重载 tunnel，然后清理自己的规则。运行前确认可以短暂中断此插件已有连接；它不重启 Daemon。

```bash
npm run verify:local -- /path/to/paseo
```

## 排查

- `paseo plugin ls` 检查插件是否 running；`paseo plugin logs tunnel` 查看启动错误。
- Relay 一直 connecting：检查 Ingress 的 `relay.endpoint` 是否从该机器可达。某些机器只能访问公网 TLS 入口。
- 401：检查认证模式和 Token；默认头是 `X-Paseo-Access-Token`。
- 502：检查 Ingress 是否在线、目标服务是否运行、Offer 是否仍有效，以及 HTTPS 证书是否可信。
- 端口占用：选择其他监听端口，或停用占用它的旧规则。

## 来源与许可

数据面基于 Paseo 的 Tunnel 实现迁出，在独立插件中重做存储、控制面与界面，并修正连接回收、流控限制、停机取消和凭据转发等问题。沿用原项目 AGPLv3 许可，见 [LICENSE](LICENSE)。本项目不修改 Paseo 核心仓库。
