# 团队模式(网关)

单人开发跑一个 loopback 网关、无 token——agent 经 stdio 自动拉起它并看到一切。一个人一个 app 时完美。但**团队**共享一个网关需要更多:谁能看哪个项目、谁能驱动浏览器、以及审计轨迹。这就是**治理模式**。

> 新手?先看[快速开始](./quickstart.md)(单人路径)。本页是 4.0 新增的团队 / 共享路径。

## 工作原理

`harness --governed` 是单一进程,把 core(数据 + 浏览器桥)和治理层(token、RBAC、审计)合在一个二进制里。没有独立 daemon——网关**就是**数据存储。

```
  浏览器 (runtime) ──WS write token──┐
  app A, app B, app C …              ▼
                     harness --governed :47950
                     (/ws  — 浏览器 runtime,write-only token)
                     (/mcp — agent,RBAC + 审计)
                     (/console — 后台 UI)
                     (/admin   — token/server 管理)
                                  ▲
  agent ──HTTP-MCP + bearer token──┘
  (read+control, projects=…)
```

每个浏览器 app 用 write-scope token 连 `/ws`,只能推数据、不能读。Agent 用绑定到特定项目的 read+control token 连 `/mcp`。

## 运行

```bash
harness --governed \
  --port 47950 \
  --admin-user admin --admin-pass "$PW" \
  --issue-token name=runtime,scopes=write \
  --issue-token name=agentA,scopes=read+control,projects=my-app
```

让 agent 指向 `/mcp`(`.mcp.json`):

```jsonc
{ "mcpServers": { "harness-fe": {
  "type": "http",
  "url": "http://127.0.0.1:47950/mcp",
  "headers": { "Authorization": "Bearer <agentA-token>" }
} } }
```

让每个 app 的构建插件指向 `/ws` 并带 runtime token:

```ts
// vite.config.ts
harnessFE({ mcpUrl: 'ws://127.0.0.1:47950/ws', token: '<runtime-token>', projectId: 'my-app' })

// next.config.mjs
withHarness({ /* …config… */ }, { mcpUrl: 'ws://127.0.0.1:47950/ws', token: '<runtime-token>', projectId: 'my-app' })
```

## 权限范围(RBAC)

- **`write`** —— 浏览器 runtime 上报事件;**绝不**授予 agent。
- **`read`** —— 遥测、会话、录制、源码、任务。
- **`control`** —— 驱动浏览器(`page.*`),受 [Consent 与运行时控制](./consent.md) 门控。

`read + control` = 完整的 agent token。网关**按 scope 过滤 `tools/list`**(read-only token 根本看不到 `page.*`),并**拒绝越权的 `tools/call`**(`-32001 scope denied`)。

## project → agent 绑定 {#project-agent-binding}

token 携带 `projects`——`['*']`(全部)或具体列表。网关把 agent 能看/能驱动的范围限定到这些项目。

这正是让团队 agent 真正看到用户会话的关键:*创建*会话的 runtime 与*读取*它的 agent 是不同的 principal,所以隔离单位是**项目**——而非创建者。

```bash
# agentA 只看/控制 my-app
harness --governed --issue-token name=agentA,scopes=read+control,projects=my-app
```

::: tip 默认拒绝(4.0)
**没有** `projects` grant 的 token 现在看到**零**个项目——连枚举都不行。可见性是按 grant 选择加入,而非选择退出。`local` / loopback 自用不受影响(看到全部)。
:::

## 审计

每次 MCP 调用都追加到 `{data-dir}/audit.jsonl`(`tokenId`、`tool`、`ip`)。在 `http://<gateway>/admin` 管理面板管理 token、查看审计日志。

## 何时用团队模式

- 多个开发者 / agent 共享一个网关。
- 共享开发 VM 或公开开发环境。
- 需要项目级隔离或审计轨迹。

否则保持单人——loopback、零配置、无 token。见[快速开始](./quickstart.md)。
