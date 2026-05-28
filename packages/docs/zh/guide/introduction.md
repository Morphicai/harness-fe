# 介绍

**Harness-FE** 通过 [Model Context Protocol](https://modelcontextprotocol.io) (MCP) 给 AI Agent 提供运行中前端应用的实时可观测能力——console 日志、网络请求、WebSocket 帧、DOM 录制,以及源码感知的元素选择器。

## 问题

AI 编码 Agent 擅长读写源代码,却对**运行时行为**视而不见:console 实际打印了什么、哪个 API 调用失败了、用户看到了什么。结果就是需要人来转述 Agent 自己观察不到的信息,形成低效的反馈回路。

## 工作方式

```
你的应用  ──build 插件──▶  运行时客户端  ──WebSocket──▶  MCP daemon  ──stdio──▶  AI Agent
(browser)               (in-page SDK)                   (:47729)
```

1. **构建插件**(`@harness-fe/vite` / `@harness-fe/webpack`)在构建时对源码做插桩——为每个 JSX 元素打上文件路径和行号。
2. **运行时客户端**捕获浏览器事件(console、网络、错误、DOM 录制),并执行 Agent 指令(click、type、navigate、screenshot)。
3. **MCP daemon** 是一个长驻进程,Agent 通过 stdio 连接它。它在 Agent 和每个已连接的浏览器 tab 之间做中转。

Agent 看到的是 `session_tail`、`page_click`、`project_where_is` 等 40+ 工具——全部限定在当前运行的 session 内。

## 核心概念

| 概念 | 说明 |
|---------|-------------|
| **Project** | 代码库的稳定身份,从 `.harness-id` 文件或 `package.json` 派生 |
| **Build** | dev server 的一次运行。重启 / 重新构建时变更;HMR 时保持稳定 |
| **Tab** | 浏览器 tab 的生命周期。通过 `sessionStorage` 跨页面刷新保持 |
| **Session** | 一次页面加载。"在一个 bug 中发生了什么"的叙事单元 |
| **Event** | 一条 console 记录、一次网络请求、一个错误、一个 DOM 快照,或一个 Agent 指令 |

## 与众不同之处

- **源码感知** —— 元素携带 `data-morphix-loc` / `data-morphix-comp`,Agent 可以调用 `project_where_is` 直接跳到 JSX 源码。
- **无云端** —— daemon 在本地运行。你的 console 日志和 DOM 录制不会离开你的机器。
- **框架无关** —— 一个 unplugin 核心支持 Vite、Webpack、Rspack、Rollup、esbuild。
- **Agent playbook** —— 安装 `@harness-fe/skill` 会在 Agent 项目里放一个 `SKILL.md`,教 Agent 如何高效使用每个工具。

## 下一步

- [快速开始](/zh/guide/quickstart) —— 3 分钟跑起来
- [架构](/zh/guide/architecture) —— 详细的分层说明
- [MCP Tools 参考](/zh/reference/mcp-tools) —— 完整工具目录
