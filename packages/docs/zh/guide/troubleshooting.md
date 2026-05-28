# 故障排查

如果时间线里没看到东西,按顺序排查。

## 1. daemon 在跑吗?

```bash
lsof -iTCP:47729 -sTCP:LISTEN
# 应该打印一行,owner 是 node(MCP server)
```

没在跑就手动启动:
```bash
pnpm exec @harness-fe/mcp-server
# 或者你已经 clone 了仓库:
pnpm start:mcp
```

日志里应能看到 `WebSocket listening on ws://127.0.0.1:47729`。

## 2. peer 连上了吗?

刷新应用时观察 daemon 的 stdout,应该看到:

```
peer connected role=runtime-client      projectId=my-app  sessionId=<uuid-A>
peer connected role=node-runtime        projectId=my-app  sessionId=<uuid-A>
```

**两行必须有相同的 `sessionId`。** 如果缺 `node-runtime`,看 §4。如果 sessionId 不同,看 §5。

## 3. 事件存哪儿?

```
~/.harness/data/
├── sessions/
│   ├── {sessionId}/
│   │   ├── meta.json              ← 这次 pageload 的参与者
│   │   ├── timeline.jsonl         ← 所有事件,每行一条
│   │   └── recording.jsonl        ← rrweb chunks
│   └── server-orphans/            ← 无请求作用域的服务端日志
└── projects/
    └── {projectId}/meta.json
```

直接读一个 session 的时间线:
```bash
ls -lt ~/.harness/data/sessions/ | head -5      # 最新优先
cat ~/.harness/data/sessions/<sid>/timeline.jsonl | jq -r '"\(.t)\t\(.payload // {})"'
```

如果你代码里的 `console.log` 不在任何时间线里,要么在 `server-orphans/`(看 §5),要么根本没到 daemon(看 §1、§4)。

## 4. 服务端事件完全缺失

Node SDK 没连上的常见原因:

| 症状 | 原因 | 解决 |
|---|---|---|
| `peer connected role=node-runtime` 从未出现 | layout 里没 `<HarnessScript>`、`next.config.mjs` 里没 `withHarness()`,也没手动 `register()` | 加一个。最简单的是把 `<HarnessScript projectId="…" />` 丢进 `app/layout.tsx`。 |
| 出现一次但之后没事件 | `NODE_ENV !== 'development'` | 自动启动按设计仅 dev 期。要无条件启用,自己调 `register()`。 |
| 连上了但事件还是缺 | `captureConsole: false` 且没用 `@harness-fe/log` | 去掉这个 flag,或迁移到 `log.*`。 |
| Edge 路由没出现 | Edge runtime 用 HTTP-batch,不是 WS——确认 daemon stdout 有 `POST /events` | 确认 `mcpUrl` 在 edge 环境下可达(`localhost` 只在 dev 期可用) |

## 5. 服务端和客户端的 `sessionId` 对不上

Harness 的要点是**一次页面加载里到处用同一个 session-id**。看到不同 id 时:

1. **确认 `<HarnessScript>` 在渲染出的 HTML 里**。刷新后查看源代码——找 `<body>` 顶部附近的 `<script id="__hfe_seed__">window.__HARNESS_FE_SEED__=…</script>`。没有 = HarnessScript 没渲染(文件错了?生产构建?)。
2. **确认运行时采纳了 seed**。在 DevTools console:`window.__harness_fe_client__.sessionId` 应等于 `JSON.parse(document.getElementById('__hfe_seed__').textContent.split('=')[1].slice(0,-1)).sessionId`。
3. **确认 provider 已注册**。跑一个 Server Component,从 `@harness-fe/node-runtime` 中 `console.log('test', getRequestSessionId())`。如果打印 `test undefined`,Next 适配器没推入它的 getter——通常意味着 `@harness-fe/next` 没在服务端被加载(检查是否真的从 `@harness-fe/next` import,而不是拼错)。

## 6. 服务端日志落到 `server-orphans/`

在没有请求作用域时这是**正确行为**:
- 顶层模块副作用(文件顶部的 `console.log('boot');`)
- 后台定时器(`setInterval(...)`)
- 来自逃出请求的 promise 的 `unhandledRejection`

要把一条日志显式归属给某个请求,用 `withHarnessTracing()`:
```ts
export const POST = withHarnessTracing(async (req: Request) => {
    console.log('this gets sid bound via ALS');
    // ...
});
```

对 App Router 的 Server Components,`<HarnessScript>` 通过 Next provider 替你做了这件事。

## 7. 两个 tab 的事件混进一个 session

不应该发生。每次 tab 刷新 = 一个新 `sessionId`。如果看到:
- 检查没手动覆盖过 `tabId` 或 `sessionId`
- 检查 `~/.harness/data/sessions/<sid>/meta.json` —— `participants` 应该是单个 tab。如果有多个,你有一个 iframe 在继承父级身份(见 ARCHITECTURE.md → "Same-origin iframe identity inheritance"),这是有意为之。

## 8. daemon 磁盘塞满

两道保险自动运行:

- **保留期**:超过 `HARNESS_FE_RETENTION_DAYS`(默认 14)的 session 在每次 daemon 启动时清理
- **大小上限**:每个 `timeline.jsonl` 上限是 `HARNESS_FE_MAX_TIMELINE_KB`(默认 4096);写入时丢弃更老的行

全部清空:
```bash
rm -rf ~/.harness/data
# daemon 下次启动时重建目录树
```

## 9. Agent 看不到新事件

MCP 的 `console_tail` / `events_recent` 工具从磁盘分页读。如果 Agent 的 session 缓存了旧游标,让它重新 list。daemon 是真相源——如果 `cat timeline.jsonl` 能看到,Agent 也能看到。

## 10. LAN 模式 —— 401 / 手机连不上

大多数 LAN 模式连通性问题落在下列几类。

### 浏览器里 "401 Unauthorized"

token 没对上。按顺序检查:

1. daemon banner 里的 token 是否准确。token 大小写敏感,前后不能有空白。
2. 如果你在 shell rc 里设了 `HARNESS_FE_TOKEN`,daemon 和你在浏览器贴的 URL 拿到的是**同一个**值吗?两个终端里都 `echo $HARNESS_FE_TOKEN`。
3. cookie。登录成功后 daemon 会 set `harness_fe_token`。如果你贴了一个 token 不同的旧 URL,清掉那个 origin 的 `harness_fe_token`(Chrome DevTools → Application → Cookies)。

### daemon 拒绝启动:"refusing to bind 0.0.0.0 without a token"

安全闸门。你绑了非 loopback host 却没传 `--token`。要么:
- 加 `--token auto` 用临时 token,或
- 先 `export HARNESS_FE_TOKEN=...` 再重跑

### 手机能访问 dashboard,但插件的 WS 连接失败

两个常见原因:

1. **macOS 防火墙挡 node**。Settings → Network → Firewall → Options → 确保 `node` 是允许的(或临时关闭防火墙确认)。Linux 上检查 `ufw status` / `iptables -L`。
2. **IP 不对**。`--host 0.0.0.0` 让 daemon 监听所有接口,但 dashboard URL 只打印**一个**自动检测的 LAN IP。在多网卡机器(Docker、VPN、多 NIC)上可能是错的那个。覆盖:
   ```bash
   npx @harness-fe/mcp-server --host 0.0.0.0 --token ... --public-host 192.168.x.y
   ```
   或者用 `ifconfig` / `ip addr` 找出正确的 LAN IP,手动替换到 URL 中。

### 浏览器 WebSocket 失败,但带 `?token=` 的 `curl` 可以

浏览器不能给 `new WebSocket(...)` 设 `Authorization` header。运行时客户端会回退到 URL query,这也是 plugin 通过 `__HARNESS_FE__.mcpUrl` 注入的方式。确认:

```js
// 页面 console 中:
window.__HARNESS_FE__.mcpUrl
// 应类似:ws://192.168.x.y:47729?token=...
```

如果 `mcpUrl` 没带 token,你的 plugin 配置里就没有。调 `harnessFE(...)` 时传 `token: process.env.HARNESS_FE_TOKEN`(或硬编码值)。

### Agent 从 MCP HTTP 拿到 401

检查 Agent 配置中的 `Authorization: Bearer <token>` header 是否与 daemon 的 token 匹配。有些客户端会去掉多行 JSON 值的尾随空白——复制粘贴时容易引入。

### "warning: bound to non-loopback host"

不是 error——是提醒。daemon 会启动,但 LAN 上拿到 token 的人都能看你的 console / 网络 / 录制。别暴露到公共 WiFi。

## 11. Vue 2 代码库 —— 文件没拿到 `data-morphix-loc`

`{{ x | filter }}` 和 `<template functional>` 不是有效的 Vue 3 语法;plugin 会跳过这些文件而不是产出坏掉的输出。跑 `HARNESS_FE_DRY_RUN=1 pnpm build` 看 stderr 上的覆盖率报告——你会得到哪些文件缺属性以及为什么。完整指南:[docs/vue2-compat.md](/zh/integrations/vue2)。

## 12. 还是卡住

- 用 `DEBUG=harness-fe:* pnpm start:mcp` 跑 daemon 拿到详细日志
- 提 issue 时附上:相关的 timeline.jsonl 片段(按需脱敏)、daemon 的 stdout、你的 Next / Vite / Webpack 版本,以及你的预期
