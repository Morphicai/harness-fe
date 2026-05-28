---
layout: home

hero:
  name: "Harness-FE"
  text: "让 AI Agent 看见并驱动你的前端"
  tagline: 接入一个构建插件,连接一个支持 MCP 的 Agent。就这样——Agent 现在可以读取 console 日志、检查网络请求、点击元素、回放会话。
  image:
    src: /logo.svg
    alt: Harness-FE
  actions:
    - theme: brand
      text: 3 分钟上手
      link: /zh/guide/quickstart
    - theme: alt
      text: 在 GitHub 上查看
      link: https://github.com/Morphicai/harness-fe

features:
  - title: 完整可观测性
    details: Console、网络、WebSocket、错误、DOM 录制——实时流式推送给 Agent,零配置。

  - title: MCP 原生
    details: 兼容 Claude Code、Cursor、Kiro、Windsurf 以及任何支持 MCP 的客户端。一个 stdio server,45+ 工具。

  - title: 源码感知
    details: 每个元素都携带 JSX 源位置。Agent 知道该编辑哪个文件、哪一行——无需猜测。

  - title: 框架无关
    details: Vite、Webpack、Rspack、Next.js、Vue、React——一个 unplugin 核心覆盖所有主流打包器。

  - title: 仅 dev 期介入
    details: 运行时仅在开发构建中加载。生产环境零开销,不向第三方上报任何遥测。

  - title: 零配置启动
    details: 添加一个插件,运行一个 daemon。无需账号、无需云端、无需 API key。
---
