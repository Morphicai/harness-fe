# Project Context

## Purpose

Harness-FE is a frontend harness for AI agents. It connects build tooling, a browser runtime client, and an MCP server so agents can inspect source-aware UI structure, drive the page, and query runtime history.

## Current Architecture

- `packages/unplugin` injects source-aware metadata and maintains the build-plugin bridge.
- `packages/runtime-client` runs in the browser and captures runtime events.
- `packages/mcp-server` brokers commands/events and owns persistence.
- `packages/protocol` defines shared message and result schemas.

## Spec Scope

OpenSpec artifacts in this repository describe user-visible and agent-visible behavior for observability, browser control, and persistence features. Technical implementation details belong in change-level `design.md` files unless they are already part of the stable system contract.
