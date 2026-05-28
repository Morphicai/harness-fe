# 在 LAN 上运行 harness-fe

daemon 默认绑 `127.0.0.1`——只有你自己的 dev 机器能到。这是正确的默认:`console_tail`、`network_tail`、`session.recordings.*` 和 dashboard 暴露的是当前运行内容的 console、网络请求和完整 DOM 录制。这些都不应出现在公开 socket 上。

为了真机调试(手机浏览器、第二台机器、RN 设备),你可以把 daemon 绑到一个可路由 IP。一旦这么做,token 鉴权就变成强制的。

## 三种模式概览

| 模式 | 绑定 | 鉴权 | 用途 |
|---|---|---|---|
| 仅本机(默认) | `127.0.0.1` | 无 | 日常自己机器上开发 |
| LAN + token | `0.0.0.0`(或具体 LAN IP) | token | 移动 / 第二台设备测试 |
| 远程 MCP | LAN + `--mcp-transport http` | token | 跨机器/Agent 共享一个 daemon |

## 仅本机

```bash
npx @harness-fe/mcp-server
```

就这样。对孵化进程的 stdio MCP,`127.0.0.1:47729` 上的 WS 桥。别的连不上。

## LAN + token

```bash
npx @harness-fe/mcp-server --host 0.0.0.0 --token auto
```

daemon 打印:

```
[harness-fe] leader: WS bridge listening on ws://0.0.0.0:47729
[harness-fe] WARNING: bound to non-loopback host 0.0.0.0.
[harness-fe]   anyone reaching this host:port with the token can read console / network / recordings.
[harness-fe] dashboard: http://192.168.1.20:47729?token=<random>
[harness-fe] token:     <random>
```

在手机上打开 dashboard URL。query string 中的 token 在首次绘制时换成 cookie,后续导航直接 work。

要在第二台设备上接 plugin 或运行时,通过 plugin 配置传同样的 token:

```ts
harnessFE({ mcpUrl: 'ws://192.168.1.20:47729', token: '<random>' })
```

或者,对于运行时客户端(script 标签替你注入 `__HARNESS_FE__.mcpUrl` 时,URL 已经带了 token——不需要额外配置)。

## 远程 MCP(HTTP 传输)

想让另一台机器上的 Agent 共享同一个 daemon?加 `--mcp-transport http`:

```bash
npx @harness-fe/mcp-server \
  --host 0.0.0.0 \
  --token auto \
  --mcp-transport http \
  --mcp-path /mcp
```

banner 会增加:

```
[harness-fe] mcp http:  http://192.168.1.20:47729/mcp?token=<random>
[harness-fe]   agent config: { "url": "http://192.168.1.20:47729/mcp", "headers": { "Authorization": "Bearer <random>" } }
```

把这段 JSON 丢进 Claude Code / Cursor / Kiro 作为 HTTP MCP server。

## 鉴权流程细节

只要**任意一项**匹配,请求即被授权:

1. `Authorization: Bearer <token>` header —— 给 Agent、CLI、服务器到服务器用。
2. `Cookie: harness_fe_token=<token>` —— 首次访问时由登录页设置。
3. URL query `?token=<token>` —— HTTP 和 WS upgrade 都适用。
4. WS subprotocol `harness-fe.token.<token>` —— 浏览器通过 WebSocket API 传 token 的唯一途径。

loopback 绑定(`127.*`、`localhost`、`::1`)完全跳过检查。

## 鉴权墙后面是什么

每个 HTTP 路由和每个 WS upgrade。具体:

- dashboard(`GET /`、`GET /sessions/:id`、…)
- 回放查看器(`GET /replay/:exportId`)
- 事件 ingest 端点(`POST /events`)
- MCP HTTP 传输(`POST /mcp`)—— 开启时
- plugin/runtime 与 daemon 对话的 WS 桥

翻译:同 WiFi 的攻击者在没有 token 时,看不到你的 console、读不到你的网络请求、刷不到 DOM 录制,也不能通过 MCP 工具面横向移动。

## 选择公开主机

如果你绑 `0.0.0.0`,daemon 会挑第一个非内部 IPv4 接口来打印 URL。多网卡机器上可能不对。用 `--public-host 192.168.x.y`(或 `HARNESS_FE_PUBLIC_HOST=...`)覆盖。

## 环境变量

每个 flag 都有 env var 等价(便于 `package.json scripts` / docker / CI):

| Env | 等价 flag |
|---|---|
| `HARNESS_FE_HOST` | `--host` |
| `HARNESS_FE_TOKEN` | `--token`(用 `auto` 自动生成) |
| `HARNESS_FE_MCP_TRANSPORT` | `--mcp-transport` |
| `HARNESS_FE_MCP_PATH` | `--mcp-path` |
| `HARNESS_FE_URL` | 旧的:完整 `ws://host:port`(被 flag 覆盖) |

## 安全提醒

LAN 模式*不是*把 daemon 放在合规反向代理后面的替代品(如果你要跟团队共享)。这里的 token 鉴权是针对同 WiFi 随手探测的纵深防御——不是生产服务的访问控制层。别把它暴露到公网。
