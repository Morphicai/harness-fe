# 开发与检查 console

复核：2026-10-03。现役工作区为 CLI → gateway → core，console-ui 提供 /console 页面。源码和英文正文共同维护当前协议；不再在翻译页重复旧版包目录、端口或存储约定。

CLI 的 listening port、core data directory、gateway data directory 与 caller/project scope 是不同设置。当前没有 dev:self-debug 脚本；console 的本地 Vite 启动不自动启用 Harness 录制。

使用前阅读[当前完整指南](../../guide/self-debug.md)与本仓 package.json/源码；旧页原文从治理 manifest 的 source commit 可恢复。
