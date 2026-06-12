---
title: "刷新一下就消失的 bug:用 harness-fe 调试流式 agent"
description: "一个来自 Morphix 的真实 bug:流式对话中刷新页面,子 agent 的结果要么重复、要么消失。第一现场在你看之前就没了。harness-fe 怎么把它捡回来 —— 以及让 agent 自己修。"
date: 2026-06-13
author: harness-fe team
---

# 刷新一下就消失的 bug

这是个真事。我在做 [Morphix](https://morphixai.com) 时撞上的 —— Morphix 是一个 AI 平台,助手会把推理和工具调用通过 SSE 流式推到浏览器,还能 spawn **子 agent**(比如"搜航班"),子 agent 的事件和父 agent 的事件交错流回。

bug 是这样:

> 你在对话中途,agent 正跑一个子 agent 任务。你刷新了页面。对话重新水合、流恢复 —— 然后子 agent 的那个工具调用要么在 UI 里**跑了两遍**,要么**结果丢了**。

它不按需复现。它需要你在某个不巧的时刻刷新,加上网络重发事件的顺序和上次略有不同。等你打开 DevTools,那个导致它的现场早就没了。

## 为什么这在 DevTools 里是噩梦

DevTools 是一扇只看**此刻、你面前这个 tab** 的窗。而这个 bug 活在它够不到的三个地方:

1. **第一现场没了。** 刷新把流式状态吹掉了 —— "我上一个处理到哪个事件"的内存游标、半拼好的消息。DevTools 是在 reload **之后**才快照的,那个关键的瞬间不可复原。
2. **事件到达浏览器的顺序 ≠ 你的 store 处理它们的顺序。** 流式对话要拼接分片、还要把乱序的子 agent 事件缓冲到它们的 `start` 到来。DevTools 给你看最终渲染的文本,不给你看*哪个事件先上的线* —— 而这恰恰决定了你会不会重复渲染。
3. **auth token 可能在你脚下轮换了。** 重连时客户端会在开新流之前重新读一次 session token。如果 token 在后台刷新了,重连就悄悄用了一个失效的,服务端把它丢掉 —— 不抛错,流就停了。DevTools 给你看 `net::ERR_…`,从不告诉你*哪个 token 哈希*发在了*哪个请求*上。

三层隐形,一个飘忽的症状。这种 bug 能吃掉你一下午。

## 到底发生了什么

它的形状(任何流式 agent 前端都有这几块):

- 一个跟踪 `Last-Event-ID` 的 **SSE reader**。重连时把这个 ID 发回去,让服务端从对的游标恢复 —— *前提是*客户端跨刷新保住了它。
- 一个**竞态保护缓冲**:比 `sub_agent_start` 先到的子 agent 事件(`thinking` / `tool_call` / `tool_result`)被按 task id 暂存进一个 map,等 `start` 到了再 flush。如果 `start` 被推迟到刷新边界之后,缓冲的生命周期和恢复游标必须达成一致 —— 否则你会重放服务端已经重发过的事件。
- 一个**每次(重)连都读的 token**:流的 `Authorization` 头每次开流都重新取。一个后台 token 刷新和这次读撞上,就足以杀死恢复的流。

重复/丢失的结果,就是缓冲和恢复游标对"什么已经送达过"的判断不一致 —— 但你只有能看见字节级的事件顺序和确切的重连头,才*看得见*这一点。而这正是 harness 的全部意义。

## harness-fe 怎么把现场捡回来

装上 harness-fe runtime 后,上面每一层隐形都成了可查询、可回放的记录 —— 而且每条事件都带着**发起它的 JS 调用栈**。

- **`network_tail`** —— 把断掉的第一条流和重连并排看。你看到第一条流最后送达的事件 id,以及重连实际发出的 `Last-Event-ID: …` 头。客户端是不是从对的游标恢复的?现在是事实,不是猜。

- **`storage_tail` + `initiator.stack`** —— 每次 token 写入,连同干这事的调用点。你看到后台刷新在 `T+2m58s` 触发,重连的 token 读在 `T+3m01s` —— 以及它们返回的是不是*同一个* token 哈希。那个静默的 401 不再静默。

- **`session_tail` / 时间线** —— 真实到达顺序的事件:`tool_result(task=42)` **早于** `sub_agent_start(task=42)` 到达;它被缓冲;刷新落地;恢复时服务端把两个都重发了 —— flush 又把缓冲那个重放在重发那个**之上**。重复就在这。

- **`session_replay`** —— 逐帧回放刷新那一刻。看清 `T-200ms`、reload、恢复时消息列表里各是什么。陈旧状态就明明白白在时间线上。

- **`project_where_is`** —— 从"那个竞态保护缓冲"直接跳到拥有它的确切 `file:line`,因为每个元素和调用点在构建时就被打了标。不用 grep,不用"这又是哪个 store"。

本来要一下午"加个 log、刷新、祈祷复现"的事,变成:读时间线、读栈、看见那个不一致、修掉游标/flush 顺序。

## 重点:是 agent 在做,不是你

上面没有一步是人在 DevTools 里点。是一个 **AI agent** 通过 MCP 工具读时间线、跳到源码行、提出修复 —— 然后**驱动浏览器重跑"流中途刷新"的流程**、检查时间线干净了。报告 → 修复 → **验证**,由 agent 自己合拢,复测 session 留作证据。

刷新一下就消失的 bug,在 harness 面前不会消失。这就是"agent 能改文件"和"agent 能调试运行中的东西"之间的区别。

## 试一试

```bash
npx @harness-fe/skill install
```

然后:*"在这个项目里接入 harness-fe。"*

- [快速开始](/zh/guide/quickstart) · [什么是 harness?](/zh/blog/2026-06-12-what-is-a-harness) · [与同类对比](/zh/#how-it-compares)
- [GitHub](https://github.com/Morphicai/harness-fe)(MIT)
