# 自调试:用 dashboard 调试 dashboard

有时你想调试的东西就是 dashboard 本身——一个布局 bug、一张渲染不出来的图表、一个停止重新拉取的 WS 订阅者。Harness 可以像驱动任何宿主应用一样驱动 dashboard:这份指南就是教你打开这个开关。

## 一行命令

```bash
pnpm dev:self-debug
```

这会启动两个进程:

| 进程 | 作用 | 端口 |
|---------|--------------|------|
| mcp-server | 自调试专用 daemon。数据存到 `~/.harness-dev`,不会污染你的正常 session 历史 | **47730** |
| dashboard-ui (vite) | 带 `HARNESS_FE_SELF_DEBUG=1` 的 dev server——注入 `@harness-fe/runtime`,这样 dashboard 页面上会出现 FAB | **5174** |

打开:`http://127.0.0.1:5174/dashboard/?token=dev`

把 Agent 连到这个 dev daemon(与默认 47729 上任何用户项目 daemon 隔离):

```jsonc
// claude_desktop_config.json / .cursor/mcp.json
{
  "mcpServers": {
    "harness-fe-dev": {
      "command": "npx",
      "args": ["-y", "@harness-fe/mcp-server"],
      "env": {
        "HARNESS_FE_PORT": "47730",
        "HARNESS_FE_TOKEN": "dev"
      }
    }
  }
}
```

现在 Agent 的 `page.click` / `page.screenshot` / `project.where_is` 工具对准的是 dashboard SPA。`project.where_is "SessionDetail"` 会直接跳到 `packages/dashboard-ui/src/routes/SessionDetail.tsx`。

## 为什么用单独的端口

你的用户项目 daemon(日常应用开发用的那个)在 **47729**。自调试 daemon 在 **47730**。它们不冲突;重启任一不会干扰另一个。各自捕获的 session 存在不同的数据目录:

```
~/.harness       — 你的用户项目 daemon(默认)
~/.harness-dev   — 自调试 daemon
```

如果你想用不同路径,在启动时覆盖:

```bash
HARNESS_FE_PORT=47731 HARNESS_FE_DATA_DIR=/tmp/harness-dev pnpm dev:self-debug
```

## 为什么没有循环依赖

依赖图保持 DAG:

```
mcp-server  ──→  dashboard-ui  ──→  vite (devDep)  ──→  runtime
     │                                                     │
     └──→  protocol  ←──────────────────────────────────── ┘
```

`mcp-server` **不**依赖 `runtime`(runtime 仅在浏览器,daemon 仅在 Node)。`dashboard-ui` 只把 `@harness-fe/vite` 作为 **devDependency** 引入,因此 mcp-server 提供的已发布 `@harness-fe/dashboard-ui` tarball 里没有任何 runtime 代码。自调试模式完全活在 dev-server 管线里。

## 行为回路

dashboard 现在在录自己。这是故意的——Agent 可以看到用户看到的。两点防止它变怪:

1. 每次页面导航都会关闭旧 session 并打开新的,所以 session 不会无界增长。
2. dashboard 的项目列表会把自调试 session 显示在 `projectId: '@harness-fe/dashboard'` 下。你可以可视化地识别并过滤它。

如果你不想让 Agent 的点击被记录到 dashboard 自己的 session 里,那就别连 Agent——dev mcp-server 也直接服务 dashboard SPA,所以你可以把它当普通 UI 用。

## 关闭

生产构建(`pnpm build` → `dist/`)**永远**不包含 runtime,无论 env vars 怎么设——vite config 会在 `command === 'build'` 时短路。已发布的 `@harness-fe/dashboard-ui` 就是普通 React。已发布的 dashboard 不可能意外变成自调试模式;必须跑本地源码树才行。

## 常见工作流

**Agent 监视下迭代 dashboard UI 改动:**
```bash
pnpm dev:self-debug
# 编辑 src/routes/SessionDetail.tsx
# vite HMR 重新加载
# 让 Agent:"click the 'Create replay' button on the first session row"
```

**排查为什么没触发重新拉取:**
```bash
# dev shell:
pnpm dev:self-debug
# Agent 中:
> page.evaluate { expr: "Array.from(document.querySelectorAll('[data-live]')).length" }
> errors.tail { n: 20 }
```

**给同事录制一个布局 bug 的复现:**
```bash
pnpm dev:self-debug
# 打开浏览器,复现
# 点 FAB → "Open dashboard"
# 在新 tab 中,点出 bug 的 session → Create replay
# 分享 /replay/<exportId> 链接
```
