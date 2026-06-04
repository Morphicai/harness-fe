# Harness-FE 架构

## 分层

![Harness-FE 分层架构](/diagrams/architecture-layers.svg)

| 层 | 包 | 职责 |
|-------|---------|---------------|
| 构建插件 | `@harness-fe/vite` / `.webpack` | 构建时的源码感知转换;转发 HMR + Node.js 日志;向 daemon 上报 `projectId` / `buildId` / `parentProjectId` |
| 运行时客户端 | `@harness-fe/runtime` | 捕获浏览器事件(console / 网络 / 错误 / rrweb);执行 Agent 指令;**从同源父 iframe 继承身份** |
| Node Runtime | `@harness-fe/node-runtime` | 服务端捕获(`uncaughtException`、`unhandledRejection`、`console.*`、Route Handler trace);ALS + provider 形式的 `sessionId` 解析;双传输(WS / 给 Edge 用的 HTTP-batch) |
| 框架适配 | `@harness-fe/next` | 把 Next.js 桥接到运行时:`<HarnessScript>` Server Component 将同一个 `sessionId` 种入 SSR HTML 和客户端;`setSessionIdProvider` DI 把 Next 基于 `cache()` 的 getter 接入 node-runtime |
| 用户 API | `@harness-fe/log` | 同构的结构化 logger;在 Server Components、Route Handlers 和 Client Components 中都是同一个 `log.info(...)`;`sessionId` 解析委托给运行时 |
| MCP Server | `@harness-fe/mcp-server` | 全局 daemon;桥接 Agent ↔ peers;拥有持久化(`IStore`)+ 项目树 |
| Unplugin 核心 | `@harness-fe/unplugin` | 所有打包器共享的转换 + WebSocket 生命周期;解析 `buildId` |
| Protocol | `@harness-fe/protocol` | wire 帧 + Zod schema + URL helper |
| JSX Runtime | `@harness-fe/react-jsx` | `jsxImportSource` 适配器,给每个 React 元素打上 `data-morphix-loc` / `data-morphix-comp`——无需打包器插件,适用于任何 React 17+ 工具链 |
| Agent Playbook | `@harness-fe/skill` | 独立 npm 包——在 Agent 项目中投放 `SKILL.md`,教它如何使用 Harness MCP 工具集 |

MCP server 是一个**全局 daemon**——不绑定任何单一项目。多个项目共享一个进程。

---

## 核心叙事概念

```
Project              ← 代码库的稳定身份(UUID,.harness-id)
  ├─ parentProjectId? ← 项目树,支持微前端
  ├─ displayName?     ← 人类可读标签(默认 package.json `name`)
  └─ Builds           ← 每次 dev server 启动 / 每次生产构建对应一份源码快照
        └─ buildId    ← HMR 期间稳定,重启 / 重新构建时变化

Tab                  ← 一个浏览器 tab 生命周期(跨刷新保持)
  └─ tabId           ← 由 sessionStorage 支撑;同源 iframe 从 window.parent 继承
       └─ Sessions   ← 每次页面加载一个("在一个 bug 中发生了什么"的叙事单元)
            └─ sessionId  ← 每次导航 / 刷新重新生成;iframe 从 parent 继承
                 └─ events: console / 网络 / rrweb / 错误 / 指令
                          ← 每行都标记 projectId + buildId
```

**为什么是这个形状**:Agent 调试问的问题是"在一次用户 session 中、跨所有运行的应用,发生了什么?"。答案 = 按给定的 `sessionId`(或 `tabId`,或 `projectId+后代`)过滤所有事件。

### 同源 iframe 身份继承

当运行时在同源 iframe 中启动时,`tryInheritFromParent()` 读取:

- `window.parent.__harness_fe_client__.tabId` / `.sessionId`
- `window.parent.__hfe_session_id__`(client global 还未设置时的回退)
- `window.parent.sessionStorage['__hfe_tab_id__']`(回退)
- `window.parent.__HARNESS_FE__.projectId` → 上报为 `parentProjectId`

跨域父级 → `SecurityError` 静默捕获 → 子级生成自己的身份。

父级运行时会在 `window.__harness_fe_client__` 和 `window.__hfe_session_id__` 上暴露自身,正是为了让子级读取。

---

## sessionId 解析(服务端)

Harness 的定义性属性:**一次页面加载 = 一个 sessionId,这次加载的所有事件(server + client + iframe)都携带它**。服务端的机制是分层的:

```
                              getRequestSessionId()
                                       │
                       ┌───────────────┴───────────────┐
                       ▼                               ▼
        1. AsyncLocalStorage                  2. 适配器提供的 provider
           (用户显式意图——                   (Next: 由 React cache()
            withHarnessTracing 包装             支撑的 getter;通过
            一个 handler)                       setSessionIdProvider 推入)
                       │                               │
                       └───────────┬───────────────────┘
                                   ▼
                       3. undefined → orphan 事件
                       (归档于 sessions/server-orphans/)
```

**为什么 ALS 优先**:用户显式意图。如果开发者用 `withHarnessTracing` 包装了一个 handler,他们就是想用那个确切的 id。

**DI 方向很关键**:`@harness-fe/node-runtime` **不**导入 `@harness-fe/next`。相反,Next 适配器的 `sessionId.ts` 模块有一个 `try { require('@harness-fe/node-runtime').setSessionIdProvider(getSessionId) }` 副作用,会在第一次 `<HarnessScript>` 渲染时触发。依赖方向是 L2 框架适配器 → L1 运行时 SDK(正确);node-runtime 保持对 React 无感。

**单次请求生命周期**:

```
请求到达
  │
  ▼
<HarnessScript> 渲染(Server Component)
  ├─ ensureNodeRuntimeBooted() ─ 仅在首次渲染时 register() node-runtime
  ├─ 副作用 import './sessionId.js' ─ setSessionIdProvider(getSessionId)
  └─ getSessionId() ────────► cache() 为本次渲染作用域分配 sid-X
                                                │
                                                ▼
                                       种入:window.__HARNESS_FE_SEED__ = { sessionId: 'sid-X' }
                                                │
Server Component 渲染,触发 console.log         │
        └─► node-runtime.getRequestSessionId() 读取 provider → 'sid-X'
                                                │
HTML 抵达浏览器                                  │
        └─► <HarnessScriptClient> 水合 → 采纳 seed → window.__harness_fe_client__.sessionId = 'sid-X'
                                                │
客户端 console.log / log.info                  │
        └─► runtime-client.sendEvent 打上 'sid-X'
                                                ▼
                          一个 sessions/sid-X/timeline.jsonl 包含全部事件
```

**跨请求隔离**:React `cache()` 底层通过 `AsyncLocalStorage` 实现请求级作用域。同一个 Next 进程被两个 tab 并行命中时,会拿到各自的 cache 作用域;它们的 `console.log` / `log.info` 落入各自的 session 时间线。由 `@harness-fe/node-runtime` 测试套件验证(28 个用例,包括一个 `Promise.all([renderA, renderB])` 交错 `console.log` 的用例)。

**Orphan 是正确的**:来自后台定时器、冷启动初始化或响应后回调的 `log.info()` 没有归属请求。把它标为 `sessionId: undefined` 并归档到 `server-orphans/` 比瞎猜更诚实。

---

## 事件类型

| 事件 | 来源 | 标记为 |
|---|---|---|
| `console` | 浏览器 `console.*`(由 runtime-client 自动捕获) | `t: 'console'` |
| `network` | 浏览器 `fetch` / XHR(自动捕获) | `t: 'network'` |
| `app-log` | 通过 `@harness-fe/log` 的显式 `log.*` 调用(浏览器或服务端) | `t: 'app-log'` |
| `server-log` | 服务端 `console.*`(由 node-runtime 自动捕获) | `t: 'server-log'` |
| `server-err` | `uncaughtException` / `unhandledRejection` / 显式 `reportError` | `t: 'server-err'` |
| `server-action` | 被 `withHarnessTracing` 包装的 handler——含耗时 + 状态 | `t: 'server-action'` |
| `task` | 用户通过 overlay 提交带注解的截图 | `t: 'task'` |
| `rrweb` | 浏览器 DOM 快照(每隔几秒一个 chunk) | 写入 `recording.jsonl` |

`app-log` vs `server-log` 的区分让 Agent 可以单独回答"展示开发者显式的 `log.warn` 调用",与"所有服务端输出(包含框架噪音)"分开。

---

## 模块交互

### 构建插件 → MCP Server

- 启动时发送 `hello`:`{ projectId, parentProjectId?, displayName?, buildId }`
- 把 HMR 更新和 Node.js stdout/stderr 作为事件帧转发(每条都标记 `buildId`)
- 响应源码情报指令:`project.source` / `project.where_is` / `project.module_graph`

### 运行时客户端 → MCP Server

- 页面加载时发送 `hello`:`{ projectId, parentProjectId?, displayName?, buildId, tabId, sessionId, visitorId?, userId?, env? }`
- 推送 `console.*`、`fetch`/XHR、`window.error`、`unhandledrejection` 事件;每行都标记 `projectId` + `sessionId` + `buildId` + `visitorId`
- 按 pageload 抓取 rrweb chunk(每个 `sessionId` 一个 `recording.jsonl`)
- 承载页面内 overlay:"H" 标记 → 信息卡 → "Report a problem" 选择器 → snapdom 截图 → 箭头/文本标注 → `task.submit` 时附加扁平化 PNG
- 执行 server 派发的指令(`page.click`、`page.type` 等)
- 为用户自管理的报告视图发送 `query` 帧(`tasks.mine` / `tasks.update` / `tasks.delete`);daemon 强制执行 visitor 所有者校验

### Node Runtime → MCP Server

`@harness-fe/node-runtime` 从 Next 的 `instrumentation.ts` 启动(或通过 `withHarness(next.config)` 自动注入)。它启动时选一种传输:

| 传输 | 何时 | 线路 |
|---|---|---|
| **WS** | Node runtime(默认) | 与浏览器 SDK 相同的 WebSocket,role 为 `node-runtime` |
| **HTTP-batch** | Edge Runtime(`process.env.NEXT_RUNTIME === 'edge'`)、`HARNESS_FE_TRANSPORT=http`,或 `require('ws')` 失败时 | daemon 上的 `POST /events`,每 500 ms / 50 事件批一次,5xx 时按指数退避重试 |

两种传输发送相同形状的 `EventFrame`。daemon 的 `bridge.ts` 接受 `role: 'node-runtime'` 的 hello,并在 sessionId 与客户端匹配时加入已有的 `SessionMeta`。

**单次刷新中服务端与客户端的 session 连续性**:`<HarnessScript>` 是 Server Component,它调用一个由 `React.cache()` 支撑的 `getSessionId()`,为每次请求渲染分配一个稳定 id,在任何客户端代码运行之前内联一段 `<script>window.__HARNESS_FE_SEED__ = { sessionId }</script>`,浏览器端运行时通过 `tryAdoptServerSeed()` 采纳这个 seed。Node SDK 读取同一个 `cache()`,所以一次刷新的服务端日志和客户端日志会落入**同一个** `~/.harness/data/sessions/{sessionId}/timeline.jsonl`。

Node SDK 默认开启的错误捕获:`process.on('uncaughtException')` / `unhandledRejection`。Server Component 渲染中抛出的错误由 SDK 的 React error boundary 集成捕获。Console 输出需通过 `HARNESS_FE_NODE_CONSOLE=1` 显式开启。Route Handlers / Server Actions 可以用 `withHarnessTracing(handler)` 包装,获得逐次调用的耗时 + 错误事件。

### MCP Server → AI Agent(stdio MCP 工具)

工具分组:

| 分组 | 工具 |
|---|---|
| 页面交互 | `page.click` / `type` / `scroll` / `navigate` / `reload` / `evaluate` / `wait_for` / `screenshot` / `dom_query` / `pick_element` |
| 遥测 | `console.tail` / `network.tail` / `errors.tail` |
| Session 回放 | `session.recordings.list` / `slice` / `replay.create` |
| 源码情报 | `project.source` / `where_is` / `module_graph` / `snapshot` |
| **项目树** | `project.list` / `get` / `tree` / `set_parent` |
| **Build** | `build.list` / `build.get` |
| Tasks | `tasks.pending` / `claim` / `resolve` |
| Memory | `project.memory.set` / `get` / `list` / `delete` |

---

## 持久化(`IStore`)

所有数据存放于 `~/.harness/data/`——daemon 的全局目录。项目只在自己的根目录写一个 `.harness-id`。

### 磁盘布局(v0.7+)

```
~/.harness/data/
├── projects/
│   └── {projectId}/
│       ├── meta.json                       ProjectMeta — id、parentProjectId、displayName、tags
│       ├── tasks.json                      标注 task 队列
│       ├── memory.json                     Agent 长期 key-value memory
│       ├── notes.jsonl                     项目级跨 session 笔记
│       ├── builds/
│       │   └── {buildId}/meta.json         BuildMeta — gitSha、dirty、bundler、sourceDigest
│       └── task-attachments/
│           └── {taskId}/{attachmentId}.png 标注截图(已扁平化)
├── tabs/
│   └── {tabId}/
│       └── meta.json                       TabMeta — userAgent、connectedAt;横跨多个 session
├── visitors/
│   └── {visitorId}/
│       └── meta.json                       VisitorMeta — 匿名 UUID + 可选 userId、env 快照、journey 索引
├── sessions/
│   └── {sessionId}/                        一次 pageload = 一个 bucket
│       ├── meta.json                       SessionMeta — tabId、url、participants[{ projectId, buildId }]
│       ├── timeline.jsonl                  parent + iframe + server 事件,每行标记 projectId+buildId+visitorId
│       └── recording.jsonl                 这次 pageload 的 rrweb chunks
└── exports/                                回放导出包(rrweb)
```

**关键设计性质**:
- Session 是顶层(一次 pageload = 一个 bucket);`projects/`、`tabs/`、`visitors/` 是同级顶层目录,仅持有元数据——它们不拥有事件。
- 每行事件都带行级 `projectId`、`buildId`、`visitorId`,跨切面查询在行侧过滤,不用合并。
- Parent + 同源 iframe 运行时共享 `sessionId`(通过 `tryInheritFromParent`)→ 它们的事件落入**同一个** `timeline.jsonl`。
- 来自 `@harness-fe/node-runtime` 的服务端事件(Node 或通过 HTTP-batch 的 Edge),与这次 pageload 对应的浏览器端事件落入**同一个** `sessions/{sessionId}/timeline.jsonl`(通过 `cache()` seed 机制)。
- `visitors/` 把用户跨刷新 / tab / iframe 的活动串起来;Agent 通过 `visitor.list` / `visitor.get` / `visitor.journey` 查询。
- v0.7 移除了对 pre-0.4 磁盘布局的 pre-1.0 读兼容;比这更老的数据需要 `rm -rf ~/.harness/data`。

### 存储策略

- **运行时事件**(高频时序)→ JSONL 追加写,通过 `WriteQueue`(每文件单写者)写入
- **结构化记录**(CRUD)→ JSON,先写后重命名的原子写
- **内存中状态** —— `SessionRouter` 跟踪活跃 peers(实时视图);磁盘是历史真相

### IStore 接口(节选)

```ts
upsertProject(projectId, patch)         // 合并;拒绝 parent-tree 环
getProject(projectId)
listProjects()

upsertBuild(projectId, buildId, patch)
getBuild / listBuilds

getProjectTree(rootId?)                 // 由 parentProjectId 装配的森林

openSession(...) / openTab / openLoad   // 事件流生命周期
append / appendBatch / appendRecording  // 事件 + rrweb
tail / search / listRecordings / sliceRecordings / sliceRecordingsByLoad
```

这个接口是未来后端的边界——`SqliteStore` / `PostgresStore` / `RemoteHttpStore` 可以实现相同的形状,而不动上游代码。schema 是 SQL 友好的(见 CHANGELOG `Unreleased` 备注)。

---

## 配置

### 基于 URL(v0.2+)

一个 env var 决定 daemon ↔ plugin 握手:

| Env var | 默认 | 含义 |
|---|---|---|
| `HARNESS_FE_URL` | `ws://127.0.0.1:47729` | daemon 监听的、plugin/runtime 连接的 WebSocket URL |

plugin 也接受显式 option:

```ts
harnessFE({ mcpUrl: 'ws://10.0.0.5:9000' })
```

解析顺序(从高到低):

1. `harnessFE({ mcpUrl: '…' })` plugin option
2. `HARNESS_FE_URL` env var
3. 默认 `ws://127.0.0.1:47729`

更早的 `HARNESS_FE_HOST` + `HARNESS_FE_PORT` 已被单一 URL 取代。

---

## 嵌入式 daemon(`createDaemon`)

CLI(`npx @harness-fe/mcp-server`)是**默认**启动路径——一个独立进程通过 stdio 讲 MCP。对于希望在自己的 Node 进程内运行 daemon(共享鉴权、存储和生命周期)的宿主应用,`@harness-fe/mcp-server` 也暴露了一个编程式工厂:

```ts
import { createDaemon } from '@harness-fe/mcp-server';

const daemon = createDaemon({
    port: 47730,
    host: '127.0.0.1',
    authorize: (req) => verifyJwt(req.headers.authorization), // 宿主的鉴权
    store: customStore,        // 可选 IStore;null 禁用持久化
    eventStore: null,          // 可选;null 禁用 Last-Event-ID 续传
    mcpHttp: true,             // 在 daemon 监听器上挂载 /mcp
    label: 'my-app',
});

await daemon.start();
process.on('SIGTERM', () => daemon.stop());
```

CLI 只是这个工厂之上的薄壳——只有**唯一一条**启动路径,所以嵌入宿主和独立用户看到完全一致的运行时行为。CLI 特有的事项(`--token` flag → `authorize` predicate;端口被占时通过 `RemoteBridge` 做 leader / follower 接管;打印 banner;信号 handler)留在 `cli.ts`,不进入工厂。

### 鉴权管线

`authorize?: (req: IncomingMessage) => boolean` 在每个 HTTP 请求和 WS upgrade 时同步运行。返回 `false` 即 401 拒绝。CLI 的 `--token <value>` 翻译为一个对配置 token 做常量时间比较的 predicate;同样形状的 predicate 暴露给宿主应用,以便它们插入 JWT / cookie / session 校验对接已有鉴权层。

幕后没有另一条独立的 token 管线——`auth.ts` 只跑一次检查,跑的就是 `authorize`。

### 可续传 SSE

HTTP MCP 传输通过一个可插拔的 `EventStore`(默认 `MemoryEventStore`:每条流 1000 事件 / 5 分钟 / 50 MiB)持久化所有出站消息。客户端用 `Last-Event-ID` header 重连时,SDK 调用 store 上的 `replayEventsAfter(id, …)`;`mcpHttp.test.ts` 的集成测试证明了接线是活的(storeEvent 在 streaming 中触发,重连时走重放路径)。设 `eventStore: null` 即可关闭。

### 范围边界(v1)

工厂**拥有自己的监听器**。挂载到宿主拥有的 `http.Server`(中间件模式)是未来增强——它需要对 Bridge 做 WS upgrade 握手层面的改造。leader / follower 跨进程接管逻辑(`RemoteBridge`)同样留在 CLI 中;嵌入模式按设计是单进程。

---

## 关键设计决策

- **磁盘是唯一真相源** —— 事件是追加写 JSONL;索引可推导,不持久化。多实例部署共享存储而无需同步。
- **`IStore` 是跨实现的唯一抽象** —— 今日 JSONL,明日 SQL。store 之上没有文件路径泄露。
- **`buildId` 独立于 `sessionId`** —— 把"运行了哪份代码"和"哪次 pageload"分开,这样生产风格的调试能 work(`build.list`、未来的 `build.timeline`)。
- **身份继承发生在运行时,而非线上** —— protocol 保持简洁;iframe 关联是客户端的事。
- **Unplugin** —— 一份 plugin 代码 → Vite / Webpack / Rspack / esbuild / Rollup 适配
- **JSONL 时间线** —— Agent 线性读取事件;不需要查询 DSL
- **全局 daemon** —— MCP server 不绑定项目;多个项目共享一个进程
- **`.harness-id`** —— 唯一写入用户项目目录的文件;其他一切位于 `~/.harness/`
