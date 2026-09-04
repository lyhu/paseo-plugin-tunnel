# 验证记录

日期：2026-09-05。

- 静态检查：TypeScript、Biome lint / format、前后端独立构建。
- 数据面：本地 workerd 运行真实 Relay；HTTP JSON、二进制上传、重复头、SSE、客户端取消、认证、错误响应以及 CONNECT / Upgrade 拒绝。
- 生命周期：独立 Host 存储、Offer 传递、密钥轮换、Token 轮换、禁用 / 启用、重启恢复、慢 HTTP 连接关闭、取消未完成 Relay 握手。
- HTTPS：临时 CA + 独立 Node 进程，正常验证证书后转发 HTTPS origin。
- 隔离 Paseo：真实子进程安装、RPC、HTTP 转发、reload、disable、enable、remove。
- 已安装的 Paseo 0.7.2：侧边栏入口与页面可见；使用现有公网 Relay 验证 HTTP 转发、401、双令牌验证 RPC（内网 Bearer 保留，Access Token 剥离）、状态脱敏、插件重载恢复。测试规则已删除，主 Daemon 未重启。
- 请求示例与验证：真实 shell 执行 curl 验证转义、双令牌 POST、响应令牌脱敏、401、禁止重定向、8 KiB 上限、SSE 首块关闭、连接失败和 10 秒超时。
- 多语言：9 种语言的键与插值参数一致；浏览器中中文 → 日文 → 英文自动切换，已有验证结果保留；已安装桌面 Paseo 确认自动显示中文。
- 新 UI 流程：创建规则后 Token 自动带入 curl，添加内网 Bearer、复制成功、Header 与 Bearer 均验证返回 HTTP 200 和真实代理响应；页面重新加载后 Token 不保留，未填 Token 时验证不可用；390px 浅色请求面板无横向溢出。
- 浏览器 UI：空名称校验、创建 Ingress、复制 Offer、导入来源预览、建议端口、端口冲突保留表单、重试成功、一次性 Token 展示；390px 浅色布局无横向溢出。

尚未验证：iOS / Android 真机、长时间压力测试及网络波动下的吞吐曲线。浏览器 UI 使用真实隔离 Daemon 的测试页面，不是移动设备模拟运行时。
