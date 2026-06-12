---
title: "harness-fe 支持 React Native 和 Flutter 吗?一个诚实的回答"
description: "今天:只支持 Web。这篇讲清为什么 —— harness-fe 到底 patch 了什么来给 agent 眼睛和手 —— 以及通往 React Native 和 Flutter 的具体技术路径:同一份契约,换一个适配器。"
date: 2026-06-14
author: harness-fe team
---

# harness-fe 支持 React Native 和 Flutter 吗?

短答:**今天,只支持 Web。** 不是文档里"即将推出"的画饼 —— runtime 现在就为浏览器发布,这就是你现在该基于它来构建的东西。

但"只支持 Web"这种回答,值得把*为什么*讲清楚。因为这个为什么,恰恰告诉你:要支持 React Native 和 Flutter 到底得改什么 —— 以及为什么我们认为那是一个**适配器**,而不是重写。

## harness-fe 到底 patch 了什么

harness-fe 给 AI agent 在运行中的前端上三样东西:**眼睛**(观察发生了什么)、**手**(驱动应用)、**地图**(从症状跳到确切的源码行)。在 Web 上,这三样都建立在本质上属于*浏览器*的机制之上:

- **眼睛**来自 `@harness-fe/sandbox`,它 patch 九个浏览器全局:`fetch`、`XMLHttpRequest`、`WebSocket`、`Storage`(local/session)、`history`、`location`、`IndexedDB`、`console`,以及全局 `window` 键。每次调用都流经一个拦截器被记录下来 —— 连同**发起它的 JS 调用栈** —— 进入一条结构化时间线。再加 rrweb 做 DOM 级**会话回放**。
- **手**来自驱动 DOM 和页面:点击、输入、导航、滚动、截图 —— 全都表达在一棵只有浏览器才有的元素树上。
- **地图**来自**构建期 transform**:它给每个元素打上 `data-morphix-loc` 源码标记,于是"这个按钮"无需 grep 就解析到 `Component.tsx:42`。

注意这个共同的原料:**一个浏览器**。在 React Native 的 bundle 里没有 `window.fetch` 可 patch,没有 DOM 给 rrweb 回放,没有 HTML 元素可以打源码属性。这不是缺了个功能 —— 这是一个不同的运行时。假装不是,就是我们拒绝做的那种过度宣称。

## 真正能迁移的部分:契约

这里有一个设计决定,让 RN 和 Flutter 从"没戏"变成"可行"。agent 从不直接和 sandbox 对话。它对话的是一套**稳定的 MCP 工具面** —— `network_tail`、`errors_tail`、`console_tail`、`storage_tail`、`page_screenshot`、`session_replay_create`、`page_click`、`project_where_is` 等等 —— 以 `sessionId` 为键。

这份契约是平台无关的。"给我最近 20 条网络请求,连同它们的 initiator 栈"在*任何*会发网络请求的运行时上都是个有意义的问题。每个平台变的只是底下的**适配器**:那个知道怎么真正捕获一次网络调用、一条日志、一次崩溃、一张截图、一次交互,并把它喂进同一条时间线、同一个 `sessionId` 的东西。

所以路线图不是"为移动端重建 harness-fe"。而是"写一个说现有契约的新适配器"。

## 通往 React Native 的路径

React Native 是更近的目标,因为它的 JS 层对好几个 channel 已经有对应物:

- **网络** —— RN 自带 `fetch`、`XMLHttpRequest`、`WebSocket`。它们能用 Web sandbox 同样的方式 patch;拦截器模型几乎直接迁移。
- **console 与错误** —— RN 有 `console` 和全局 error / `unhandledRejection` 面。捕获很直接。
- **存储** —— 没有 `localStorage`;对应物是 `AsyncStorage`(以及 MMKV、SQLite)。同一个*想法*(键值写入打到时间线上),但要 wrap 的 API 不同。
- **没有 DOM 的眼睛** —— rrweb 用不上;没有 DOM。回放变成**截图 + 原生视图树**,而不是序列化的 HTML 变更。
- **手** —— 驱动意味着在 RN 组件树上点按/输入,而不是点 DOM 节点。
- **地图** —— 源码映射从 Web 打包器插件,挪到 **Metro / Babel transform**,把 RN 元素 / `testID` / 无障碍标签 / 组件名映射回文件。同样的 `file:line` 收益,不同的构建步骤。

具体说,路线图条目是一个 dev-only 的 `@harness-fe/react-native` runtime client,覆盖 console / 错误 / 网络 / 截图 / 交互,共享同一套 `sessionId` + MCP 语义 —— 外加一流的 **Expo** 支持(含带原生模块的 dev client)和基于 Metro 的源码映射。

## 通往 Flutter 的路径

Flutter 是更难的那个,值得直说:**没有 JavaScript。** 你 patch 不了 `window.fetch`,因为没有 `window`、应用里没有 JS 引擎。适配器必须活在 **Dart** 里。

现实的形态是一个 Dart 侧的 SDK,挂到 Flutter 自己的可观测缝隙上 —— VM service 协议 / `dart:developer`、Dart 的 `HttpClient` 与日志、widget 树、截图 —— 并把它们以同一个 `sessionId` 转发给 daemon。agent 看到的契约(`network_tail`、`errors_tail`、`page_screenshot`、一个 widget 树查询)保持一致;只有捕获机制是全新的。这比 RN 是更大的工程量,所以它在路线图上靠后。

## 那今天你该怎么办?

如果你做的是 **Web**,harness-fe 已经就绪 —— `npx @harness-fe/skill install`,你的 agent 就有了眼睛、手和一张源码地图。如果你在 **React Native 或 Flutter** 上,诚实的回答是:还不行,而且我们不会为了骗个 star 告诉你别的。关注[路线图](https://github.com/Morphicai/harness-fe);RN 适配器是下一个平台前沿,而它将要说的那份契约已经存在了。

我们想让你记住的是:harness-fe 不是"一个浏览器工具"。它是**一份关于 agent 如何观察并驱动运行中应用的契约** —— 而浏览器,只是第一个实现它的运行时。

## 试一试(今天,在 Web 上)

```bash
npx @harness-fe/skill install
```

- [快速开始](/zh/guide/quickstart) · [什么是 harness?](/zh/blog/2026-06-12-what-is-a-harness)
- [GitHub](https://github.com/Morphicai/harness-fe)(MIT) · [Roadmap](https://github.com/Morphicai/harness-fe/blob/main/ROADMAP.md)
