---
title: Chrome DevTools 不好用？不妨试试 harness-fe
description: 一个真实的 dev 阶段调试痛点。Chrome DevTools MCP 解决了一部分，harness-fe 想往前再走一步。
date: 2026-05-28
author: harness-fe 团队
---

# Chrome DevTools 不好用？不妨试试 harness-fe

![harness-fe](/blog/images/2026-05-28-devtools-vs-harness/00-banner.png)

## 背景

你有没有遇到过这样的痛：

1. 测试同学撞到 bug，等你接手的时候第一现场的日志已经不在了
2. 多账号并行测试，要在多个浏览器实例 / Chrome profile 里登不同账号来回切
3. 移动端测试，日志收集成本极高，要靠截图、录屏、相机拍

先说清楚:这个痛点不是我一个人臆想的。[Chrome 官方工程博客](https://developer.chrome.com/blog/chrome-devtools-mcp)自己就承认,当下的 coding agent "看不到自己生成的代码在浏览器里跑起来到底做了什么 —— 实际上是在蒙着眼睛编程"。

而 [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) 正是 Chrome 团队对这个盲区给出的官方答案,而且它很能打 —— 按官方说法,它能"在 live 页面上检查 DOM 和 CSS、分析网络请求和 console 日志、录制并分析性能 trace、导航/填表单/点按钮来模拟用户行为",甚至能"自动验证代码改动是否如预期工作"。如果你的问题是"驱动我面前这个 tab,告诉我此刻在发生什么",DevTools MCP 是一个出色的、第一方的工具,该用就用。

所以这不是"DevTools 不行"。我做过一些尝试,但一直没真的用起来,原因在它的**工作模型**:"Agent 远程操作我此刻 attach 到的那一个 tab,并读取它当下能看到的东西"。**所有信息都来自 agent 当下去看**;但我前面那几个场景,信息是过去的、是分散在不同实例里的、是不在我面前的那个浏览器里的。这是两条我反复掉下去的边。

我理想中的状态是：测试同学提出 bug，Agent 自己就能知道第一现场是什么，甚至复原第一现场，然后结合代码立马定位问题、解决问题，最后自己再驱动浏览器验证一遍问题。

![理想的反馈闭环](/blog/images/2026-05-28-devtools-vs-harness/01-feedback-loop.svg)

## Harness 工程

本质上我们要构建的是一个**能让 Agent 得到反馈的闭环**。当然也可以是人给反馈，但人在信息传递上往往是低效的——根据 Caltech 2024 年的研究 [《The unbearable slowness of being》](https://www.caltech.edu/about/news/thinking-slowly-the-paradoxical-slowness-of-human-behavior)，人处理信息的速度大概只有 **10 bits / 秒**。一段对话能传递的细节，远少于一份 session timeline；而且人在转述时还会无意识地过滤、加工。

所以构建一个开发闭环显得非常重要，**不仅仅是服务于业务**。当信息能自动回流给 Agent 时，人就能从“信息中转站”的角色里抽身，更多去关注架构、开发范式；让人与 Agent 高效的协作，可能会成为下一阶段前端开发的必须。

## 为什么想到开发 Harness

我自己最近在构建 [Morphix](https://morphixai.com) 的时候，我的时间真的非常少。我也是一个很懒惰的人——让我去手动点点测试，不仅效率低，而且即便发现了 bug 我也很有可能没有收集到足够的信息。索性帮 Agent 搭建一个能自己取证的工具。

Morphix 本身是一个让用户自己生成 App 的平台。用户可以通过对应用的反馈，或者应用自动产生的反馈，让生成的 App 变得更好、更健壮。这背后的范式跟 harness-fe 是同一套：**让信息自动回流，让 Agent 自动迭代**。

只有这样，我才可能利用有限的时间来做更多新的尝试。

## 实现原理

harness-fe 由三层组成：

![harness-fe 架构图](/blog/images/2026-05-28-devtools-vs-harness/02-architecture.svg)

**构建插件**:`@harness-fe/vite` / `@harness-fe/webpack` / `@harness-fe/next` 在打包阶段对源码插桩，给每个 JSX 元素加上 `data-morphix-loc="src/Form.tsx:42:8"`。Agent 看到一个元素就直接知道源码位置，不需要 grep，不需要 react-devtools。

这一点恰好戳中一个具体差异。截至 2025 年底,Chrome DevTools MCP 的 `list_console_messages` 返回的栈,**指向的是打包/转译后的文件和行号,即便 bundle 带了有效的 sourcemap 也不映射回原始源码**([chrome-devtools-mcp #695](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/695))。也就是说,即便 Agent *能*看到一个 runtime 错误,回到*你的*代码的线索也会断在 `vendor.a3f9.js:1:88421`。harness-fe 从另一头解决:不在读取时映射,而在**构建时**就把源码出处烙进元素。"这个按钮"直接就是 `Form.tsx:42`。

**Runtime**:`@harness-fe/runtime` 是注入到浏览器的 in-page SDK，在 runtime 层 hook 所有副作用——console、network(fetch / XHR)、localStorage / sessionStorage / cookie 写入、WebSocket 帧、navigation、未捕获错误、rrweb DOM 录制。**每条事件都附带一份 JS 调用栈**(`initiator.stack`)，这意味着 Agent 拿到事件的同时拿到“谁触发的”。

**MCP daemon**：本地长驻进程，默认监听 `localhost:47729`。所有数据保存在 daemon 里，跨 tab、跨 dev-server restart、跨 HMR 都不丢。Agent 通过 stdio MCP 连接，以工具调用的形式查询事件：`storage_tail` / `network_tail` / `session.timeline` / `visitor.timeline` / `project_where_is` / `session_recordings_around` 等四十多个工具，文档在 [/zh/reference/mcp-tools](/zh/reference/mcp-tools)。

这套设计与 Chrome DevTools MCP 的根本差异在于：**信息是被动捕获并持久化的，而不是 agent 主动去 attach 当下那个 tab 才能看到**。

举个例子，Agent 查 `auth_token` 是被谁清的：

```
> storage_tail({ op: 'remove', key: 'auth_token' })
```

返回的事件带着完整的 JS 调用栈，顶端的 user-code 帧直接指向哪个文件的哪一行清的——不需要复现，不需要断点。

## 如何使用

一行命令把 skill 投递给 agent:

```bash
npx @harness-fe/skill install
```

skill 是一份 [`SKILL.md`](/zh/reference/mcp-tools)，会被放到 `.claude/skills/harness-fe/`(其他 agent 类似目录)。Agent 下次会话读这个文件就知道：

- 怎么在项目里装 runtime 和构建插件
- 怎么写 MCP daemon 的 stdio 配置
- 什么场景下调哪个工具
- 不明确时去 [harness-fe.com](https://harness-fe.com) 查文档

然后对 agent 说一句“在这个项目里接入 harness-fe”，剩下的 Vite / Webpack / Next.js / Electron 集成 agent 会自己完成。各种集成路径在[文档](/zh/integrations/vite)里都有。

::: tip 它不是 APM
harness-fe 的 runtime 只在 dev build 注入，生产构建里不存在。零运行时开销，零隐私顾虑。它不取代 Sentry / Datadog，定位是 dev 阶段你和 agent 一起调试本地代码的工具。
:::

## 未来的规划

完整路线图在 GitHub 公开维护：[ROADMAP.md](https://github.com/Morphicai/harness-fe/blob/main/ROADMAP.md) 配套愿景文档 [VISION.md](https://github.com/Morphicai/harness-fe/blob/main/VISION.md)。借用自动驾驶的分级思路，我们按 SDLC 阶段把成熟度分成三层：

**L3 — 开发阶段（dev）**：单人开发者 + Agent 协作（当前主线，`main` 分支 / npm `latest` 标签）。本文涉及的全部能力都在这一层——开发者本人在 dev server 跑代码，Agent 取证 + 定位 + 修复，人 review 后 merge。短期还会补：多打包器覆盖（Rspack / esbuild / Rollup 通过 unplugin 共用一套适配）、流式 child-agent spawn、以及基于现有 [overlay plugin API](/zh/reference/overlay-plugins) 的 Jira / Linear 开箱接入。

**L4 — 测试阶段（test）**：团队共享 daemon，快速发现 / 快速解决（`next` 分支 / npm `@next` 预发，实验中）。让 QA、产品、开发同时连一台自托管的 daemon——QA 在测试环境撞到 bug 的那一刻，第一现场已经在 daemon 里，开发的 Agent 立刻可以 claim 任务、拉 timeline、定位源码、给修复建议。关键技术点是把调用方身份贯穿到 tool 层、`project.list` / `session.list` / `tasks_pending` 按归属过滤、`sendCommand` 限定在调用者自己的 tab 范围内，以及 MCP session 隔离 + project↔agent 绑定索引。这一层 ready 之后，"测试同学撞到 bug → Agent 取证"才能在团队规模下安全跑。

> 老实说，**L4 这条测试协作线目前还远未完成**——L3 个人开发者场景是稳的，L4 的身份/隔离层还在 `@next` 预发里慢慢推。但这是一个值得做、也已经开了头的方向。我把它公开写在路线图上，是希望吸引同样在思考"AI Agent 怎么真正接管前端调试和验证"的同道一起共建。harness-fe 想做的不只是一个工具，而是 **Harness 前端开发范式**的一次尝试，这件事一个人或者一个小团队做不到。

**L5 — 生产阶段（prod）**：用户反馈直接打通到开发团队（L4 之后）。这是 Harness 范式真正落地的样子：**线上终端用户撞到问题，反馈和当时的 session timeline 自动回流到开发团队的 Agent**，Agent 拉源码、定位、提 PR、走 review——不需要人工转述、不需要复现、不需要客服-产品-开发三层翻译。技术底座是生产可用的云服务：多实例无 SPOF、可插拔存储后端（SQLite / Postgres / S3）、远程 MCP、严格多租户安全、SLA。开源 + 自托管的版本一直会在，云服务是额外的选项，不是替代。

**生态覆盖**（独立于成熟度分级，持续推进）。端到端目标是：每一个 Agent 生成的前端项目，默认就带 runtime。`@morphixai/code` mini-app 模板默认接入 `@harness-fe/log` 和 `<HarnessScript>`、`npx @harness-fe/create-app` 一键 scaffold、`@harness-fe/react-native` 给 RN / Expo 提供同等能力（sessionId / MCP 语义一致）。

更长期看，AI Agent 在前端开发里要真正发挥协作价值，工具链需要先把信息基建建好。harness-fe 是这个方向上的一个具体尝试。代码、issue、PR 都在 GitHub 上欢迎参与：[github.com/Morphicai/harness-fe](https://github.com/Morphicai/harness-fe)。

---

- **文档**:[harness-fe.com](https://harness-fe.com)(English / 简体中文)
- **GitHub**:[Morphicai/harness-fe](https://github.com/Morphicai/harness-fe)(MIT)
- **3 分钟上手**:[/zh/guide/quickstart](/zh/guide/quickstart)
- **架构详解**:[/zh/guide/architecture](/zh/guide/architecture)
- **完整工具目录**:[/zh/reference/mcp-tools](/zh/reference/mcp-tools)
