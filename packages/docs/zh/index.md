---
layout: home

hero:
  name: "Harness-FE"
  text: "给 AI Agent 一双眼、一双手,和你的源码地图"
  tagline: 开发期 harness——让 MCP Agent 看见前端的 console、网络与 DOM,驱动页面,并把每个元素追溯到确切的文件与行号。报告 → 修复 → 验证,一个闭环。
  image:
    src: /logo.svg
    alt: Harness-FE
  actions:
    - theme: brand
      text: 3 分钟上手
      link: /zh/guide/quickstart
    - theme: alt
      text: 与同类对比
      link: "#how-it-compares"
    - theme: alt
      text: 在 GitHub 上查看
      link: https://github.com/Morphicai/harness-fe

features:
  - icon: 🎯
    title: 源码感知,精确到行
    details: 每个元素都携带 JSX 源位置。Agent 知道该改哪个文件、哪一行——无需猜测、无需 grep。这是任何调试器都给不了的部分。
  - icon: 👁️
    title: 全栈可观测
    details: Console、网络、WebSocket、错误、rrweb DOM 录制——实时流式推送给 Agent。回放任意会话,看清到底发生了什么。
  - icon: 🕹️
    title: 安全地驱动浏览器
    details: Agent 可点击、输入、导航、求值——都在用户掌控的 consent 门控之后。按 app 选择开启,或一键禁止。
  - icon: 🔌
    title: MCP 原生
    details: 兼容 Claude Code、Cursor、Kiro、Windsurf 及任何支持 MCP 的客户端。一个 server,45+ 工具,stdio 或 HTTP。
  - icon: 👥
    title: 团队就绪(4.0)
    details: 一个共享网关、受限 token、调用方身份与租户隔离——队友互不干扰,各自只看到自己的项目。
  - icon: 🌱
    title: 仅 dev 期,零负担
    details: 运行时仅在开发构建中加载。生产零开销,不向第三方上报遥测,无需账号或 API key 即可开始。
---

<div class="home-section">

## 为开发期的 Agent 闭环而生 {#why}

Harness-FE 不是生产监控,也不是通用浏览器机器人。它是那一层缺失的桥梁——让 AI 编码 Agent 能**看见你的应用在做什么、驱动它、并准确知道该修哪一行源码**,然后通过回放该流程来验证修复。接入一个构建插件,指向一个支持 MCP 的 Agent,报告 → 修复 → 验证的闭环便自行合拢。

## 与同类对比 {#how-it-compares}

其他工具各自覆盖一部分。Harness-FE 是唯一为**开发者**的 Agent 闭环端到端打造的——源码感知、全栈、且仅 dev 期。

| | **Harness-FE** | Chrome DevTools MCP | browser-use 等 | Sentry / LogRocket |
|---|:---:|:---:|:---:|:---:|
| **定位** | 开发期 Agent 闭环 | 浏览器调试 | 终端用户任务 Agent | 生产监控 |
| 源码感知(file : line) | ✅ | ➖ | ➖ | ➖ |
| 报告 → 修复 → 验证闭环 | ✅ | ➖ | ➖ | ➖ |
| 全栈可观测¹ | ✅ | 🟡 | ➖ | ✅ |
| Agent 驱动页面 | ✅ | ✅ | ✅ | ➖ |
| 会话回放(rrweb) | ✅ | ➖ | ➖ | ✅ |
| 多打包器 / 框架² | ✅ | ➖ | ➖ | 🟡 |
| MCP 原生 | ✅ | ✅ | 🟡 | ➖ |
| 仅 dev · 零生产负担 | ✅ | ✅ | ⚪ | ➖ |
| 团队隔离 + 治理 | ✅ | ➖ | ➖ | ✅ |

<p class="home-fineprint">✅ 支持 &nbsp;·&nbsp; 🟡 部分 / 有条件 &nbsp;·&nbsp; ➖ 不支持 &nbsp;·&nbsp; ⚪ 不适用 &nbsp;&nbsp;|&nbsp;&nbsp; ¹ console + 网络 + WebSocket + 错误 + DOM 录制 &nbsp;·&nbsp; ² Vite · Webpack · Rspack · Next.js · Vue · React</p>

<div class="home-cta">

**三分钟跑通第一个 Agent 驱动的会话 →** [快速开始](/zh/guide/quickstart) · [团队模式](/zh/guide/team-mode) · [从 3.x 迁移](/zh/guide/migration-3-to-4)

</div>

</div>
