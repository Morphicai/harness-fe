# 用 Docker 自托管 harness-fe

适用场景:

- 团队想在一台 dev VM 上跑一个共享 daemon,而不是每个开发者各自 `npx`。
- 想要一个可复现的容器,而不是依赖宿主的 Node 版本。
- 跑 CI / 预览环境,需要 daemon 与 dev server 一起启动。

不适用:

- 你是一个开发者在笔记本上。`npx @harness-fe/mcp-server` 更简单更快。
- 你期望源码感知的 MCP 工具(`project_source`、`project_where_is`)能跨多个项目从中心 daemon 工作。这些工具从磁盘读源码树;集中式多项目源码访问尚未支持——见 ROADMAP "Phase B" 备注。

## 镜像

```
morphixai/harness-fe:<version>
morphixai/harness-fe:latest
```

由 [`.github/workflows/docker.yml`](../.github/workflows/docker.yml) 在 `@harness-fe/mcp-server` 每次 npm 发布成功后发布。多架构(`linux/amd64` + `linux/arm64`)。

## 快速开始

```bash
docker run --rm -p 47729:47729 \
  -e HARNESS_FE_TOKEN="$(openssl rand -base64 24)" \
  -v harness-data:/data \
  morphixai/harness-fe:latest
```

容器中与 `npx` 不同的默认:

| Env | 镜像中默认 | 原因 |
|---|---|---|
| `HARNESS_FE_HOST` | `0.0.0.0` | 容器内唯一合理的绑定 |
| `HARNESS_FE_MCP_TRANSPORT` | `http` | stdio 跨不出容器边界 |
| `HOME` | `/data` | daemon 的 `~/.harness` 落到挂载卷上 |

你**必须**提供 `HARNESS_FE_TOKEN`。daemon 在非 loopback 绑定上没有 token 时拒绝启动。

## docker-compose

参考的 compose 文件在 [`examples/docker/docker-compose.example.yml`](../examples/docker/docker-compose.example.yml)。复制一份并放上 `.env`:

```bash
cd examples/docker
cp .env.example .env
# 编辑 .env,设 HARNESS_FE_TOKEN=...
docker compose up -d
docker compose logs -f
```

停止 / 清空:

```bash
docker compose down            # 保留卷
docker compose down -v         # 清空 session + 录制 + task
```

## 持久化

daemon 写入的所有东西——session、timeline JSONL、rrweb chunk、task 记录、持久 memory——都在 `/data` 卷下。挂载一个具名卷(compose 默认)或宿主路径:

```bash
-v /srv/harness:/data
```

通过快照该路径备份。容器启动前替换该路径即可恢复。

## 接入客户端

### 构建插件

```ts
harnessFE({
  mcpUrl: 'ws://<docker-host>:47729',
  token: process.env.HARNESS_FE_TOKEN,   // 与容器同一 token
})
```

dev 机器上和容器里设同一个 env var = 无需额外配置。

### 浏览器

访问 `http://<docker-host>:47729/?token=<token>` 一次。daemon set cookie;后续导航不需要 query string。

### 远程 Agent(Claude Code / Cursor)

```jsonc
{
  "type": "http",
  "url": "http://<docker-host>:47729/mcp",
  "headers": { "Authorization": "Bearer <token>" }
}
```

(镜像默认开启 MCP HTTP 传输——见上面的 env 默认。)

## 对外 URL 与 `--public-host`

daemon 打印链接(dashboard、回放查看器)时,挑第一个看到的非内部 IPv4。**容器里这几乎总是 bridge 网络地址**,外面没人到得了。

把 `HARNESS_FE_PUBLIC_HOST` 设为 docker 宿主的 LAN IP 或 DNS 名:

```yaml
environment:
  HARNESS_FE_PUBLIC_HOST: dev.example.internal
```

## TLS

内置无。如果你要把它暴露到可信 LAN 之外,在容器前面用反向代理(nginx / Caddy / Traefik)做 TLS termination。token 鉴权本身不保护传输中的流量。

## 还**没有**包含的东西

Phase A 故意只是个单 token 的薄镜像。下一阶段为真正多租户团队使用会加上:

- 多 token,带按 token 的 ACL / 审计链路
- 按用户 / 按团队的 session 隔离
- 远程 `project_source`(构建插件上传源码内容,daemon 不需要文件系统访问每个项目)

如果你的团队需要其中任何一项,提 issue 描述你的用例。

## 本地构建

针对未发布的修改测试 Dockerfile:

```bash
docker build -t harness-fe:dev \
  --build-arg VERSION=2.0.0 \
  packages/mcp-server/
```

镜像总是从 npm 安装包——没有路径从本地源码复制。要测试 prerelease 代码,先发布一个 prerelease tag(`@harness-fe/mcp-server@x.y.z-rc.1`)。
