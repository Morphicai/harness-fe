# 一台机器上的多个 daemon

## 规则

> **daemon 身份 = 监听端口。**
> 同一端口 = 同一 daemon = 同一份数据。
> 不同端口 = 独立 daemon,独立数据。

身份就是你写在 `mcp.json` 里的 URL。无项目根检测,无 `.git` 回溯,无 `cwd` 魔法——两份 MCP 配置都指向 `ws://127.0.0.1:47729`,就是在跟同一个 service 说话。就这样。

## 磁盘布局

```
~/.harness/
└── daemons/
    ├── 47729/
    │   └── data/
    │       ├── projects/…
    │       ├── sessions/…
    │       ├── visitors/…
    │       └── exports/…
    ├── 47730/
    │   └── data/
    └── …
```

每个端口拥有自己的子树。清掉 daemon 47730 的历史就是删 `~/.harness/daemons/47730/`——别的不受影响。

## 如何选

### "我就是想让它能跑" —— 默认共享 daemon
任何地方都别配 `--port`。每个 IDE(Cursor、Claude Desktop、Claude Code、Kiro)都打到 `47729`。第一个启动的成为 leader;其余自动作为 follower 接入,看到同一份浏览器状态。

```jsonc
// claude_desktop_config.json / .cursor/mcp.json / etc.
{
  "mcpServers": {
    "harness-fe": {
      "command": "npx",
      "args": ["-y", "@harness-fe/mcp-server"]
    }
  }
}
```

### "我想让 project-A 和 project-B 分开"
按项目选不同端口。

```jsonc
// project-a/.cursor/mcp.json
{
  "mcpServers": {
    "harness-fe": {
      "command": "npx",
      "args": ["-y", "@harness-fe/mcp-server", "--port", "47729"]
    }
  }
}

// project-b/.cursor/mcp.json
{
  "mcpServers": {
    "harness-fe": {
      "command": "npx",
      "args": ["-y", "@harness-fe/mcp-server", "--port", "47730"]
    }
  }
}
```

每个端口有自己的数据目录。项目 A 的录制不会出现在项目 B 的 dashboard 里。

### "Monorepo:`apps/web` + `apps/admin` + `apps/marketing` 用一个 dashboard"
用默认——它们自动汇入 47729。dashboard 的项目列表按各自的 `projectId`(由各自 vite/webpack 插件设置)显示每个子应用,全在一个 daemon 下。

### "banner / dashboard 里的友好名"
`HARNESS_FE_LABEL` 是一个表象标签——出现在启动 banner 和(未来的)dashboard 标题中。它**不**影响隔离;隔离永远是端口。

```jsonc
{
  "command": "npx", "args": ["-y", "@harness-fe/mcp-server"],
  "env": { "HARNESS_FE_LABEL": "my-mono" }
}
```

banner 变成:
```
[harness-fe] leader: WS bridge listening on ws://127.0.0.1:47729  (my-mono)
[harness-fe] data:   ~/.harness/daemons/47729/data
```

两个 daemon 可以共享 label 或用不同 label——控制隔离的 daemon 始终是端口。

## 跨 IDE 怎么办?

一些 IDE(Cursor、Kiro、Claude Code CLI)启动 MCP 子进程时把 `cwd` 设为 workspace 目录。其他(Claude Desktop)从全局应用目录启动,对项目无感。

**在这个模型里都不要紧。** 因为身份就是端口,所有目标 `47729` 的 IDE 都落到同一 daemon,无论从哪儿启动。cwd 无感问题消失。

## 清理

要清掉某个 daemon 的数据:删它的端口子目录。

```bash
rm -rf ~/.harness/daemons/47730
```

daemon 死掉后内核回收端口;不需要额外操作。

## 为什么不用 "project root" / cwd / `.git` 检测?

早期设计草稿尝试自动发现项目根并把数据目录键到文件系统路径上。复盘时这个模型在跟自己打架:daemon 的身份已经是它服务的 URL。加文件系统启发式重复了 URL 已经携带的信息,同时引入失败模式(Claude Desktop 不传 workspace cwd;monorepo submodule 里 `.git` 会匹配到等等)。

按端口键的模型更简单也更诚实。挑端口就跟挑数据库是同一手势——用户选择隔离单元,我们尊重他们的选择。
