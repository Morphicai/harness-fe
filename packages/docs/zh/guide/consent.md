# Consent 与运行时控制

读取遥测无害。**驱动**页面(`page.click`、`page.type`、`page.evaluate` 等)则不然——所以 4.0 起控制命令运行在 consent 门控之后。本页讲 app 级默认,以及叠加在其上的用户运行时 opt-in。

## 默认是 `deny`

4.0 安全默认翻转了:控制命令默认**被拒绝**,除非有人主动开启。app 通过构建插件 / `<HarnessScript>` 的 `consent` 选项声明默认:

| 模式 | 行为 |
|---|---|
| `deny` **(默认)** | 所有控制命令立即拒绝——无提示。 |
| `off` | 不提示;控制自由运行。loopback / 单人开发便利。 |
| `session` | 每次页面加载向用户询问一次,然后本会话记住。 |
| `always` | 每个控制命令前都提示。 |

```ts
harnessFE({ projectId: 'my-app', consent: 'off' })       // 自用:自由运行
harnessFE({ projectId: 'my-app', consent: 'session' })   // 每次加载问一次
```

`page.evaluate`(任意 JS)**始终**提示,无论什么模式。

在治理[团队模式](./team-mode.md)中,网关对其 peer 强制 `session`,所以共享部署绝不会静默允许控制。

## 运行时 opt-in(用户的最终决定权)

app 默认只是默认。**终端用户**可以直接从页内 overlay 允许或禁止某 app 的 agent 控制——info 卡片里的一键开关。其选择持久化在 `localStorage`(`__hfe_runtime_control__:{projectId}`),并**覆盖** app 默认与网关默认。

这弥补了用户此前无从拒绝的缺口:即便 app 发布 `consent: 'off'`,用户也能把控制关掉,且刷新后依旧生效。

编程访问(例如自建开关):

```ts
window.HarnessFE.getRuntimeControl()        // 'allow' | 'ask' | 'deny'
window.HarnessFE.setRuntimeControl('deny')  // 持久化 + 立即重新门控
```

## 解析顺序

有效门控按优先级从高到低解析:

```
用户选择 (localStorage)  →  app `consent` 选项  →  网关默认  →  deny
```

即:用户 `deny` 永远胜出;否则由 app 的 `consent` 决定;再否则由治理网关的模式;最后落到安全的 `deny` 兜底。

> 未来的 `runtimeControl: { scopes }` 选项将让 app 额外声明 agent *可用哪些*能力(如只读、禁止 `evaluate`)——这是 `consent` 单独表达不了的维度。见 [per-app 控制策略设计](https://github.com/Morphicai/harness-fe/blob/main/docs/design/per-app-control-policy.md)。
