---
title: "什么是 harness?AI Agent 与你的前端之间,缺的那一层"
description: "Coding agent 已经很会写代码了。可一旦代码在浏览器里跑起来,用 Chrome 自己的话说,它依然是在『蒙着眼睛编程』。harness 就是把这块眼罩摘下来的那一层 —— 一双眼、一双手,和一张回到确切源码行的地图。"
date: 2026-06-12
author: harness-fe team
---

# 什么是 harness?

下面这句话来自 Google Chrome 自己的工程博客,描述的是我们今天几乎每天都在用的 AI coding agent:

> "它们看不到自己生成的代码在浏览器里跑起来到底做了什么。它们**实际上是在蒙着眼睛编程**。"
> —— [Chrome DevTools 团队](https://developer.chrome.com/blog/chrome-devtools-mcp)

这不是竞品的挑衅。这是**做浏览器的那个团队**在描述当前的技术现状。值得停下来想一想,因为它重新定义了"AI 辅助前端开发"里到底坏在哪 —— 而 "harness" 就是那个修法的名字。

## 这块眼罩是真的,而且很具体

你的 coding agent —— Cursor、Claude Code、Copilot、Windsurf —— 确实有一件事做得很好:读你的仓库、推理、写出补丁。然后补丁变成**运行中的应用**,Agent 就两眼一抹黑了。

它不是笼统地瞎,而是瞎在一组具体的、能一条条列出来的东西上。正如一位开发者[逐项列举](https://dev.to/bluehotdog/ai-coding-tools-that-actually-see-your-browser-2026-2hoc)的:这些工具从源码文件工作,看不到 **rendered DOM、computed styles、布局几何、编译后的模块图、注册的路由、server log**。一个不响应的按钮、一个返回 401 的请求、一个刷新就重置的状态 —— 全都活在 Agent 从未见过的 runtime 里。

于是真正发生的,是这位作者称之为 **"describe-check-fix 循环"** 的东西:AI 改一版,**你**去浏览器里看,不对,**你**再描述一遍。你成了 Agent 的眼睛、手和 grep。这不是 Agent 在干活,这是你在干活、还多了几道工序。

而且它有一个比"慢"更糟的失败模式。另一位工程师在大量测试后[这样说](https://www.huuhka.net/browser-verification-for-coding-agents-chrome-devtools-mcp-vs-agent-browser/):"除非你给模型某种真正去看结果的办法,否则它会乐呵呵地告诉你一切正常。" Agent **并不知道**自己是瞎的。它会对着一个坏掉的 UI 报告成功 —— 而且很自信。同一来源指出,当前模型"远没有可靠到能仅凭代码就把 UI 推理正确"。

**看着完成了。其实坏的。** 这就是整个行业此刻在交的税。

## harness,一个故意选的词

**harness**(挽具)来补这道缺口,而这个词是我们刻意选的。挽具,是你套在一个**强壮、且正在运动**的东西上的 —— 一匹马、一个攀登者、一个跳伞者 —— 让你能**观测它、驾驭它,而不必替换它**。你不重造那匹马,不为了检查而让它停下,你只是扣上一层,抓住正在发生的一切。

Agent 和你前端的关系,正该如此。应用在跑。你不想冻结它、mock 它,或为了可调试而重写它。你想做的,是给这个活的东西套上薄薄一层,让 Agent 能**看着它、操纵它,而且关键是,把它看到的任何东西追溯回产生它的那行源码**。

## harness-fe 到底做什么

harness-fe 是浏览器的开发期挽具。接入一个构建插件,指向一个支持 MCP 的 Agent,Agent 就在你**运行中**的应用上获得三种能力:

- **眼睛** —— console、网络、WebSocket、storage、错误、DOM(经 rrweb)的结构化、可回放时间线。不是让 Agent 眯着眼看的截图,是一份它能**查询**的记录。而且每条事件都携带**发起它的 JS 调用栈**(`initiator.stack`)—— 于是"谁清了 `auth_token`?"是一次查询,不是一场调试。
- **手** —— 它可以在页面里点击、输入、导航、求值,都在你掌控的 consent 门控之后。
- **源码地图** —— 每个元素都携带 JSX 出处(`data-morphix-loc`),"这个按钮"直接解析成 `Button.tsx:42`。无需猜测、无需 grep、无需翻 react-devtools 考古。

Agent 读时间线、跳到源码行、提出修复,然后驱动浏览器回去**证明**它。报告 → 修复 → 验证,一个 Agent 自己合拢的闭环 —— 而不是每一步都绕道一个不停复制粘贴日志的人。

## harness 是什么,也由"它不是什么"定义

这是个拥挤的赛道,所以边界很重要:

- 它**不是 DevTools —— 也不是 Chrome DevTools MCP。** 那些是 attach 到 Agent *此刻*面前那一个 tab。Chrome DevTools MCP 是真实而有能力的(它能查 live DOM/CSS、读网络和 console、驱动页面)。但它是**按需、在当下**观察。harness 是**被动捕获并持久化** —— 于是现场能挺过一次 reload、一次 HMR、一次 tab 切换,挺过"QA 撞到了"和"Agent 来看"之间的那段空隙。(我们在[另一篇](/zh/blog/2026-05-28-devtools-vs-harness-fe)里深入对比。)
- 它**不是生产监控。** Sentry / LogRocket / OpenReplay 替人盯生产;harness **仅在 dev 期**运行,零生产开销,不向第三方上报遥测。
- 它**不是浏览器机器人。** browser-use 这类驱动浏览器去完成终端用户任务;harness 的存在是帮**你**修**你的**应用 —— 观测、定位、驱动、验证。

这些边界正是重点。harness 是那一层薄薄的、开发期的桥梁,把"Agent 能改文件"变成"Agent 能调试运行中的东西"。

## 为什么是现在

两件事汇到了一起。第一,Agent 写代码已经好到让瓶颈**转移**了:难的不再是*写*修复,而是*知道到底哪儿错了*、以及*证明修复生效* —— 这两者都活在运行中的应用里,不在仓库里。

第二,现在有了一条标准的线。[Model Context Protocol](https://en.wikipedia.org/wiki/Model_Context_Protocol) 由 Anthropic 在 2024 年 11 月推出,OpenAI 于 2025 年 3 月采纳、Google 几周后跟进;到 2026 年它已[在大大小小的公司里跑在生产环境](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)。这意味着 harness 不必是某一个 Agent 的插件 —— 它可以只说一种每个 Agent 都已经懂的协议。runtime 喂出时间线,MCP 把它送到你用的任何 Agent。

那两条线交叉的那一刻,眼罩就摘下来了。harness 只是那个把握住这个机会的层。

## 试一试

```bash
npx @harness-fe/skill install
```

然后告诉你的 Agent:*"在这个项目里接入 harness-fe。"*

- [快速开始](/zh/guide/quickstart) · [DevTools vs harness-fe](/zh/blog/2026-05-28-devtools-vs-harness-fe) · [与同类对比](/zh/#how-it-compares)
- [GitHub](https://github.com/Morphicai/harness-fe)(MIT)
