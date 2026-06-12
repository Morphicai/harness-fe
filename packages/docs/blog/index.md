---
title: Blog
description: Engineering notes, debugging case studies, and release deep-dives from the harness-fe team.
---

# Blog

Engineering notes, debugging case studies, and design decisions.

## 2026

- [Does harness-fe work with React Native or Flutter? An honest answer](/blog/2026-06-14-react-native-flutter) — 2026-06-14
  > Today: web only. The why — what harness-fe patches for eyes and hands — and the concrete path to RN and Flutter, where it's the same contract behind a different adapter.
- [The bug that vanishes when you refresh: debugging a streaming agent with harness-fe](/blog/2026-06-13-streaming-agent-reconnect-bug) — 2026-06-13
  > A real bug from building Morphix: refresh mid-stream and a sub-agent's results duplicate or disappear. How harness-fe gets the lost first scene back.
- [What is a harness? The missing layer between your AI agent and your frontend](/blog/2026-06-12-what-is-a-harness) — 2026-06-12
  > Your AI agent can write code but can't see or touch your running app. A harness gives it eyes, hands, and a map back to the exact source line.
- [Chrome DevTools MCP vs. harness-fe: two honest answers to the agent's blind spot](/blog/2026-05-28-devtools-vs-harness-fe) — 2026-05-28
  > DevTools MCP is real and good — but it attaches to the current tab, and its console traces point at bundled code, not your source. Where a persistent dev harness draws a different line, with a real session and a cited gap.
