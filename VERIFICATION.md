# 质量与集成验证记录 (Verification Record)

> **验证基线**：2026-09-05 · Paseo 0.7.2 · Node.js 22+ · HTTP Tunnel 0.2.0
>
> **迁移说明**：HTTP Tunnel 0.3.0 起改用 Paseo 0.8 运行时入口（`index.server.ts` / `index.client.tsx`，目录 `server/` / `client/` / `shared/`），清单声明 `requirements.paseo >= 0.8.0`。下表 0.7.2 部分为 0.2.0 的历史记录；0.3.0 已在 Paseo 0.8.0（桌面宿主）完成安装与数据面回归，见第 4 节。

本文档记录 Paseo HTTP Tunnel 在发布前完成的各层级测试与集成验证结果，覆盖数据链路、协议兼容性、生命周期和宿主集成；验证范围与尚未覆盖的场景如下。

---

## 1. 工程与代码质量 (Static & Build Quality)

- **类型检查**：全量 TypeScript 类型检查通过（`npm run typecheck`）。
- **规范校验**：Biome 代码风格检查及格式化校验通过（`npm run lint`、`npm run format:check`）。
- **构建独立性**：客户端（`client/`）、服务端（`server/`）、共享（`shared/`）三分目录构建解耦，符合 Paseo 0.8 的编译边界。

---

## 2. 协议与数据面 (Data Plane & Protocol)

- **Relay 传输验证**：基于本地独立 workerd 实例运行真实 Relay 链路测试：
  - **负载类型**：标准 JSON、大文件二进制流式上传/下载、HTTP 重复响应头。
  - **流式传输 (SSE)**：支持 Server-Sent Events 流式直推，数据帧平滑转发不落盘、不整体缓冲。
  - **流控与窗口**：双向 $8 \times 64\text{ KiB}$ 滑动窗口机制测试，首块 ACK 触发滑窗，验证无需等待整批 ACK 才发送下一块。
  - **预连接池**：Egress 预建立最多 2 条空闲通道，显著降低单次请求握手耗时；空闲 30s 自动过期回收。
  - **异常终止**：客户端主动取消请求、未完成 Relay 握手取消、上游异常断开时关联资源即时释放。
  - **非目标协议阻断**：严格拒绝 `CONNECT` 隧道、`WebSocket Upgrade` 及未授权 TCP 转发。
- **HTTPS 证书校验**：构建临时私有 CA 并拉起独立 Node 进程，严格遵循 HTTPS 证书信任链校验后完成 Origin 转发。

---

## 3. 生命周期与存储管理 (Lifecycle & Persistence)

- **配置原子性**：`$PASEO_HOME/tunnel/config.json` 采用临时文件写入 + 同步刷盘 + 原子重命名机制，权限严格锁定为 `0600`。
- **密钥与凭据生命周期**：
  - Ingress Route Secret 轮换：旧 Offer 即时失效，新 Offer 替换后重新建立握手。
  - Egress Access Token 轮换：单向 SHA-256 哈希校验，支持恒定时间对比防时序攻击；明文仅生成时返回一次。
- **热启停与恢复**：
  - 插件禁用（Disable）与启用（Enable）：即时释放监听端口与 WebSocket 连接，重新启用时从持久化存储自动恢复。
  - 热重载（Reload）：`paseo plugin reload http-tunnel` 重新加载逻辑，不拉取远端代码，不依赖主 Daemon 重启。

---

## 4. 宿主与集成环境 (Host & Integration)

- **隔离子进程集成**：在受控的独立 Paseo 环境中验证插件安装、RPC、HTTP 转发、`reload`、`disable`、`enable`、`remove`。另以隔离 CLI 验证短 GitHub 来源及完整 URL 安装、`ls`、`status` 和更新检查。
- **真实宿主 (Paseo 0.7.2，迁移前基线)**：
  - 侧边栏入口（Network 图标）正常渲染，RPC 通信稳定。
  - 配合公网 Relay 验证全链路转发、401 拦截以及双令牌隔离（业务内网 Bearer 头透传，Tunnel Access Token 剥离）。
  - 状态 RPC 校验：确保返回数据全面脱敏（不包含 Token 原文、哈希或私钥）。
  - 验证后测试规则清理完毕，Paseo 主 Daemon 未重启。
- **真实宿主 (Paseo 0.8.0，2026-09-11)**：以目录来源在 Paseo 桌面 0.8.0（daemon 0.8.0、app 0.8.0）上重装验证：
  - 入口与清单：旧的单一 `index.ts` 安装被 daemon 拒绝并给出迁移指引；迁移后的 `index.client.tsx` / `index.server.ts` 与 `requirements.paseo: ">=0.8.0"` 安装成功，状态为 `running`。
  - RPC 注册：daemon 记录 `Loaded plugin`，列出全部 12 个方法（`tunnel.state.get`、`tunnel.ingress.*`、`tunnel.egress.*`），与 `index.server.ts` 一致。
  - 数据面：两条已存 Egress 自动恢复监听（`127.0.0.1:1380`、`127.0.0.1:17013`），经公网 Relay 对远端 Origin 的实测返回 `HTTP 200`（`/docs`，1006 B；`/` 返回源站自身的 `404`）。
  - 生命周期：`reload` 与 `disable` → `enable` 均正确释放端口并恢复；daemon 日志为 `Stopping plugin` → `Plugin stopped` → `Loading plugin` → `Plugin ready`。
  - 配置完整性：`$PASEO_HOME/tunnel/config.json` 在卸载与重装前后逐字节一致，身份、规则与凭据未受影响。

---

## 5. UI/UX 与交互验证 (Interface & Experience)

- **多 Host 协同流程**：
  - 右上角 Host 切换器正常响应，精确隔离当前机器的 Ingress/Egress 规则上下文。
  - 跨 Host 配置：通过 Ingress 复制 Route Offer，平滑导入至远端 Egress。
- **请求生成与快速验证**：
  - 自动生成符合 POSIX shell 转义的精确 `curl` 示例。
  - 一次性 Access Token 仅在当前会话内存保留，刷新页面即清除；未输入 Token 时验证按钮自动置灰。
  - 快速验证限定绑定本地 Loopback，执行 10s 严格超时控制，阻断重定向追踪，响应预览限制最多 8 KiB 且自动脱敏回显令牌。
- **多语言与移动端适配**：
  - 覆盖 9 种语言，语言键值对及插值完全对齐；切换语言时现有验证结果平滑保留。
  - 在 390px 紧凑视口下，浅色主题的请求面板无横向溢出。

---

## 6. 待覆盖与后续计划 (Pending Scope)

- [x] **Paseo 0.8 宿主回归**：安装、RPC 注册、数据面转发、`reload` / `disable` / `enable` 已在 Paseo 0.8.0 上完成（见第 4 节）。
- [ ] **0.8 客户端界面目视确认**：侧边栏入口、管理页与多语言渲染需在 Paseo 0.8.0 界面中人工确认；`remove` 未在 0.8 上重测，以免中断当前可用安装。
- [ ] **移动端真机验证**：当前在桌面版及浏览器真实隔离环境下完成测试，iOS / Android 原生运行时仍需真机回归。
- [ ] **高并发极限压测**：持续数小时以上的高并发网络抖动与带宽饱和场景下的长周期吞吐曲线测试。
