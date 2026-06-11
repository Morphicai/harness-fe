# 从 3.x 迁移到 4.0

4.0 保持**单人开发体验**不变,但重构了内部以加入**团队线**:一个共享 daemon 供多人协作而互不干扰——身份、租户隔离、治理网关。本指南列出变更点与迁移方式。

> 如果你只在 loopback 上自用,简版结论是:**`consent` 现在默认 `deny`**——需主动开启(或用 overlay 开关)才允许 agent 控制页面。其余都是内部改动。

## 破坏性变更

### 1. 控制授权默认 `deny`
3.x 中 agent 控制命令(`page.click`/`page.type` 等)无门控直接运行。4.0 安全默认改为 **`deny`**:控制命令被拒,除非显式开启。通过插件 / `<HarnessScript>` 的 `consent` 选项设置:

```ts
harnessFE({ consent: 'off' })       // loopback 自用:直接运行,不提示
harnessFE({ consent: 'session' })   // 每次页面加载向用户询问一次
harnessFE({ consent: 'deny' })      // 完全禁止控制(默认)
```

4.0 新增:**用户**也可在页内 overlay 一键允许/禁止控制,其选择会持久化并**覆盖** app 默认。见 [runtime opt-in](#runtime-opt-in)。

### 2. 网关是唯一入口(架构重构)
单体 daemon 被拆分为可组合的包:

| 包 | 职责 |
|---|---|
| `@harness-fe/core` | 与传输无关的后端(daemon 库) |
| `@harness-fe/gateway` | 治理:token 生命周期、scope RBAC、project→agent 绑定、审计、管理面板 |
| `@harness-fe/cli` | 唯一的 `harness` 启动器 |
| `@harness-fe/console-ui` | 网关服务的 dashboard SPA |

浏览器 **runtime 默认连接网关 `/ws`**。自用场景 CLI 仍会替你拉起一切,无需改配置。

### 3. 项目可见性对受限 token 默认拒绝
无显式 project grant 的网关 token 不再能枚举/读取项目与会话(此前 unowned 数据对任何 token 可见)。给 token 绑定所需项目:

```bash
harness --issue-token name=agentA,scopes=read+control,projects=my-app
```

`local` / loopback 自用不受影响——仍可见全部。

### 4. linked group 大版本跳变
所有核心包一起升到 `4.0.0`(如 `@harness-fe/runtime` `3.4.0 → 4.0.0`),即使个别包无 API 变化——它们共享一条版本线。锁定到 `4` 并整组升级。

## 迁移步骤

### 自用(零配置)——基本不变
现有配置继续可用。唯一要决定的是控制授权:保持 `deny`(agent 不能控制页面),或设 `consent: 'off'` / 用 overlay 开关允许。daemon 配置(`.mcp.json` 里的 `npx @harness-fe/mcp-server`)不变。

### 团队(4.0 新增)
运行一个共享网关,签发受限 token,把 agent 绑定到项目。完整设置见[网关 / 团队模式](https://github.com/Morphicai/harness-fe/blob/main/docs/gateway-team-mode.md)。简述:

1. `harness serve --governed`——启动共享、带 consent 门控的网关。
2. 为 app runtime 签发 write token,为每个 agent 签发 read+control token,各自用 `--issue-token` 绑定到项目。
3. 把各 app 的插件 / `<HarnessScript token=…>` 指向网关 URL。

## 4.0 新能力 {#runtime-opt-in}

- **调用方身份 + 租户隔离**——每次调用携带"谁";agent 只看到被授权的项目/会话。
- **project→agent 绑定**——token 可见已绑定项目的整套数据,无论每行由哪个 runtime client 创建。
- **浏览器 consent + runtime opt-in**——控制命令需批准;用户可在 overlay 允许/禁止 agent 控制且选择持久化。
- **任务闭环回链**——`tasks.resolve` 记录修复 commit / PR / 复测 session,闭合"报告 → 修复 → 验证"。
- **Console dashboard**——网关提供按身份隔离的丰富 dashboard。

团队架构的来龙去脉见 [Roadmap](https://github.com/Morphicai/harness-fe/blob/main/ROADMAP.md)。
