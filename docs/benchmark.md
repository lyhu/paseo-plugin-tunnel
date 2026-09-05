# HTTP Tunnel 性能验证

## 结论

插件通过预建加密通道降低请求握手延迟，通过滑动确认窗口减少流式传输停顿。改动仅涉及插件，不需要修改 Paseo、Relay 或目标服务。未引入业务响应缓存：模型 POST 请求和 SSE 不适合透明缓存，缓存会改变生成语义、认证隔离和计费行为。

连接预算、过期策略与请求生命周期见 [插件设计](design.md#请求与流控)。

## 固定负载对比

测试日期：2026-09-05。基线为 `75b3017`，对比本次预连接及滑动窗口实现。Ingress、Egress 和固定 HTTP 目标在同一台 macOS 机器，数据经真实网络 Relay 与 TLS；直连样本访问同一个 loopback 目标。每种负载运行 6 轮，每轮依次直连、Tunnel；下表取后 5 轮各指标的中位数。每轮开始前等待 1 秒，使预连接有机会就绪，因此结果代表有预连接可用时的表现，不代表长时间空闲后的首次请求。

| 负载与指标 | 基线 | 优化后 | 降幅 |
| --- | ---: | ---: | ---: |
| 256 B 响应头到达 | 442.69 ms | 82.44 ms | 81.4% |
| 1 MiB 完整传输 | 2416.57 ms | 1348.10 ms | 44.2% |
| SSE 首个 Body 到达 | 427.99 ms | 101.57 ms | 76.3% |
| SSE 完整传输 | 1778.48 ms | 1369.78 ms | 23.0% |
| SSE 单次请求最大收包间隔 | 150.07 ms | 83.57 ms | 44.3% |

SSE 目标每 10 ms 写一个事件，共 100 个事件、23290 B。定时器实际执行受系统调度影响：两次测试的直连总耗时中位数分别为 1090.70 ms 和 1087.14 ms。两组 1 MiB 直连耗时分别为 1.25 ms 和 1.51 ms。原始匿名样本位于 [基线](../benchmark/results/transport-before.json) 与 [优化后](../benchmark/results/transport-after.json)。

这是单机、单 Relay、少量顺序样本，网络状况可能变化；不能推导其他部署的固定提速比例。收包间隔是 HTTP 数据块间隔，不等同于 SSE 事件间隔，也不能单独证明某一层存在缓冲。两项优化同时启用，不能用该表单独归因各项收益。

## 模型服务对照

优化前从同一客户端交替测量 Nginx 与 Tunnel，各 2 次。服务提供者确认两条路径使用同一后端服务，但 model 别名及返回的 thinking/text 表达不同。

| 指标 | Nginx | Tunnel（优化前） |
| --- | --- | --- |
| 首次输出（thinking 或 text） | 0.39–0.44 s | 2.15–2.26 s |
| 首次 text | 2.93–3.35 s | 2.15–2.26 s |
| 输出阶段平均速率估计 | 108–109 token/s | 105–106 token/s |
| 最大输出事件间隔 | 0.52–0.59 s | 0.79–1.04 s |

Nginx 返回独立 thinking delta；Tunnel 的该次上游响应只返回 text delta。首次输出时间不能直接视为纯代理开销。输出 token 数为 914–1000，生成长度与停止原因不同，不能直接比较总时长。速率按上游报告的输出 token 数除以首末输出事件时间差估算，不是模型的精确解码速率。固定负载实验用于消除这些业务差异。

## 实际部署复验

本地 Egress 通过 Git 更新；远程 Ingress 保留其 Linux 锁文件提交，单独应用性能提交并重载插件。两端 runtime 文件 SHA-256 一致，Paseo 主 daemon 未重启。远程只安装运行依赖，未运行开发用 TypeScript 检查；类型检查、lint、构建和回归测试在本地完成，远程由 Paseo 编译加载并通过真实请求验证。

用仓库中的 SSE 脚本，对相同 Tunnel 路径和 model 别名再次采样：

| 样本 | 首次输出 | 完整耗时 | 输出 token | 最大输出事件间隔 |
| --- | ---: | ---: | ---: | ---: |
| 更新前 | 2078 ms | 9856 ms | 757 | 742 ms |
| 更新后首轮 | 2644 ms | 10477 ms | 589 | 612 ms |
| 更新后连续请求 | 535 ms | 8104 ms | 754 | 709 ms |

三次均为 HTTP 200，收到完整 `message_stop`，以 `end_turn` 结束。匿名数据见 [实际请求样本](../benchmark/results/model-tunnel.json)。连续请求首输出较基线降低约 74%，但更新后首轮未改善；本次未采集实际业务请求的预连接命中计数，不能据此精确分摊握手、排队及生成耗时。样本量不足以声称稳定的业务提速比例，约 0.7 秒的最大事件间隔仍存在。预连接可用时的收益由固定负载实验验证，远距离 Relay 时延和上游输出节奏仍是延迟来源。

## 复现

在插件仓库根目录运行 `npm ci`。默认使用本地 workerd Relay，无需现有 Paseo 配置：

```bash
npm run benchmark:transport
```

使用自己管理的网络 Relay 时，通过环境变量提供连接信息；TLS 默认启用：

```bash
BENCH_RELAY_ENDPOINT='relay.example.com:443' npm run benchmark:transport
```

脚本创建临时身份和规则，使用随机 loopback 端口，退出时清理。它不读取或修改现有 Tunnel 配置。标准输出仅包含匿名 JSON 样本；保留结果时使用不含主机名的文件名。`BENCH_PRECONNECT=0` 可关闭预连接，仅比较同一实现的握手影响。

对比其他版本时，将该版本检出到独立目录、安装其依赖，并通过 `BENCH_SOURCE_ROOT=/absolute/path/to/checkout` 指定源码。仍从当前仓库运行相同脚本，以保持负载和采样方法一致。基线版本不支持预连接选项，会忽略该选项。

Anthropic SSE 测量使用原生 Node HTTP/HTTPS，不使用 shell 的 HTTP 代理变量：

```bash
export BENCH_URL='http://127.0.0.1:1380/v1/messages'
export BENCH_MODEL='your-model'
export BENCH_LABEL='tunnel'
npm run benchmark:sse
```

通过受保护的环境注入 `BENCH_API_KEY`（上游 `x-api-key`）、`BENCH_ACCESS_TOKEN`（Tunnel Header Token）、`BENCH_BEARER_TOKEN`（`Authorization: Bearer`）。Bearer 用于 Tunnel 认证时不能同时承载业务 Bearer Token；此时采用 Tunnel Header 认证。不要把实际凭据写入命令示例、仓库或报告。

模型脚本固定相同 prompt、1000 token 上限和 streaming/thinking 参数，兼容服务需自行映射 `BENCH_MODEL`。比较端点时交替运行至少数轮，保留停止原因、token 数与 thinking/text 区分。结果不输出地址、凭据、模型名或响应正文；匿名标签也不要使用真实主机名。连接超时 8 秒、总时限 120 秒，HTTP 错误、流错误、无输出或缺少结束事件均返回非零退出码。

## 回归验证

- 双向滑动窗口测试阻塞 8 个 ACK，仅释放第一个，验证第九个 Body 块继续发送。旧实现在该断言超时，新实现通过。
- 预连接测试覆盖上限、认证前不领取、预建不调用目标、并发请求隔离、空闲过期、无后台重连循环及停止清理。
- 生命周期、取消、HTTPS 和连通检查通过真实 HTTP、Relay 与加密链路验证。
- SSE 解析测试覆盖任意 HTTP 分块位置、CRLF 与多行 data。

```bash
npm run test:file -- src/server/performance.test.ts
node --test benchmark/sse-parser.test.mjs
```
