# Electron / 多窗口宿主集成

harness-fe 是为浏览器设计的,但 Electron / Tauri / Capacitor / 嵌入式 CEF WebView 中的 renderer 进程依然是浏览器上下文——构建插件 + 运行时客户端可以直接用。

本页记录唯一需要宿主侧配合的一点:多窗口 sessionId 共享。

## seed 契约

`@harness-fe/runtime` 在启动时同步读取两个全局变量:

```ts
window.__HARNESS_FE__         // ← 由构建插件注入
                               //   (mcpUrl, projectId, buildId, token, …)

window.__HARNESS_FE_SEED__    // ← 可选,宿主提供
  ?.sessionId                  //   覆盖自动生成的 sessionId
```

如果 `__HARNESS_FE_SEED__.sessionId` 存在,会胜过运行时自己的 `crypto.randomUUID()`。`@harness-fe/next` 的 `<HarnessScript>` 就是这样对齐 SSR 和 CSR 的——但 seed 是一个完全通用的扩展点。任何你能写进那个字段的值都行。

## 为什么你会想设它:多窗口宿主

Electron 给每个 `BrowserWindow` 开一个独立 renderer 进程。每个 renderer 有自己的 `sessionStorage` 和自己的运行时实例——所以默认每个窗口生成自己的 sessionId。daemon 会把它们记为 N 个独立 session,`session.tail` / `session.recordings.*` 一次只能看一个窗口。

对多数多窗口应用,你想要的恰好相反:**一个 session 横跨用户打开的每个窗口,每个窗口一个 tabId**。

```
session: <一个共享 uuid>
├── tab: <主窗口 tabId>
├── tab: <设置窗口 tabId>
└── tab: <devtools 弹窗 tabId>
```

现在 `session.tail` 返回完整的跨窗口时间线;Agent 看到用户的完整行为。

## 怎么做:任何跨窗口同步原语都行

挑你的宿主已有的——harness-fe 不关心:

| 机制 | 备注 |
|---|---|
| `BroadcastChannel` | 标准浏览器 API;在共享同一 origin + Electron session/partition 的 renderer 进程之间可用 |
| `localStorage` + `storage` 事件 | 同源同 partition 的回退方案 |
| Electron `ipcMain` + `ipcRenderer` | 主进程持有一个 UUID,启动时通过 IPC 分发到每个 renderer |
| Tauri events / Capacitor 插件 | 同形状,不同传输 |
| 宿主自己的状态同步库 | 应用已经有就复用 |

## 骨架

在 import 运行时**之前**设 seed。运行时构造时是同步读,所以 seed 必须已经挂在 `window` 上。

```ts
// renderer 入口,仅 dev 期
if (process.env.NODE_ENV === 'development') {
  void (async () => {
    const sessionId = await yourSharedStateLib.getOrCreate(
      'harness-fe:session',
      () => crypto.randomUUID(),
    )
    ;(window as any).__HARNESS_FE_SEED__ = { sessionId }
    await import('@harness-fe/runtime')
  })()
}
```

第一个启动的窗口写入 UUID;后续窗口读到已存储的值,从而拿到相同 sessionId。它们的 tabId 仍然不同,因为 `tabId` 以各自 renderer 的 `sessionStorage` 为键。

## 验证

在每个窗口的 DevTools 中:

```js
window.__HARNESS_FE_SEED__.sessionId   // 所有窗口相同
window.__harness_fe_client__?.tabId    // 每个窗口不同
```

如果两个检查都通过,daemon 会记录一个合并的 session,Agent 的 `session.tail` 会浮现每个窗口的事件。

## 重置 session

把 seed 设为新 UUID,通过同一同步机制通知每个窗口。每个收到变更的 renderer 在下一次页面 reload(或宿主立即触发)时应用。适合做 "clear logs / start fresh" 这样的 devtool 按钮。

## 注意事项

- **生产构建**:把所有这些藏在 `NODE_ENV` / feature flag 后面。运行时 + 插件本来就是 dev-only,但 seed 接线不应该发布到终端用户。
- **首次启动竞态**:如果两个窗口同时启动且你的同步原语不是强原子,两个 UUID 可能会竞争。短期不一致无害——daemon 会记录最多两个简短 session,然后收敛。要更强保证,用宿主的 "window 1 就绪后" 信号阻止 window 2 启动。
- **跨域 renderer**:如果你的窗口从真正不同的 origin 加载,`BroadcastChannel` / `localStorage` 桥不过去。用宿主进程的 IPC。
