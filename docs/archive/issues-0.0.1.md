# Harness-FE Bug Report

**版本**: 0.0.1  
**测试日期**: 2026-05-14  
**测试环境**: macOS, Node.js, Kiro IDE (MCP follower 模式)  
**测试项目**: `examples/react-demo` (Vite + React + React Router)

---

## Bug #1 — 多标签页命令超时（WebSocket 端口不一致）

**严重程度**: 🔴 高  
**状态**: ✅ 已修复（2026-05-18）

### 修复结果

1. `packages/unplugin/src/core.ts:87-91` 让插件读取 `HARNESS_FE_PORT` / `HARNESS_FE_HOST`，与 `cli.ts` 对称。
2. `.mcp.json` 和 `.kiro/settings/mcp.json` 移除 `env` 覆盖，全部回落到 `DEFAULT_WS_PORT=47729`。demo 不需额外配置。
3. 后续如需改端口：要么改 `packages/protocol/src/index.ts` 的 `DEFAULT_WS_PORT` 常量（一处生效），要么在 mcp.json env + 启动 vite 的 shell 里都设同一个 `HARNESS_FE_PORT`。

以下保留原始诊断记录供参考。


### 现象

`tab.list` 返回 3 个已连接标签页，但其中 2 个对所有命令均超时 30 秒：

```
MCP Tool Error Response: remote-bridge: "sendCommand" timed out after 30000ms
```

### 根本原因

**端口配置存在两条独立路径，互不感知。**

**路径 A — MCP 服务器进程**（`cli.ts`）：
```typescript
// packages/mcp-server/src/cli.ts
const port = Number(process.env.HARNESS_FE_PORT ?? DEFAULT_WS_PORT);
```
`.kiro/settings/mcp.json` 通过环境变量将端口设为 `9999`：
```json
"env": { "HARNESS_FE_PORT": "9999" }
```
→ MCP bridge 监听 `ws://127.0.0.1:9999`

**路径 B — Vite 插件**（`unplugin/core.ts`）：
```typescript
// packages/unplugin/src/core.ts:83
const mcpUrl = options.mcpUrl ?? `ws://127.0.0.1:${DEFAULT_WS_PORT}`;
//                                                   ↑ DEFAULT_WS_PORT = 47729
```
`vite.config.ts` 没有传入 `mcpUrl`：
```typescript
// examples/react-demo/vite.config.ts
harnessFE({ projectId: 'react-demo' })  // 无 mcpUrl
```
→ Vite 插件连接 `ws://127.0.0.1:47729`

**路径 C — 浏览器 runtime client**：
Vite 插件在 HTML 中注入：
```typescript
// packages/unplugin/src/core.ts:248
window.__HARNESS_FE__ = ${JSON.stringify({ projectId, mcpUrl })};
```
`mcpUrl` 的值来自路径 B，即 `ws://127.0.0.1:47729`。

**结果**：
- MCP 服务器（Kiro 调用的那个）监听 `:9999`
- Vite 插件和浏览器 runtime client 连接到 `:47729`（一个不同的 bridge 实例，或根本不存在）
- `tab.list` 返回的标签页是注册在 `:47729` bridge 上的，但 Kiro 的命令通过 `:9999` bridge 发出，永远找不到对应的 runtime client → 超时

### 涉及文件

| 文件 | 行号 | 问题 |
|------|------|------|
| `packages/unplugin/src/core.ts` | 83 | `mcpUrl` 硬编码 `DEFAULT_WS_PORT`，不读取环境变量 |
| `examples/react-demo/vite.config.ts` | 4 | 未传入 `mcpUrl` |
| `.kiro/settings/mcp.json` | 8 | `HARNESS_FE_PORT=9999` 只传给 MCP 进程，不传给 Vite |

### 修复方案

在 `unplugin/core.ts` 中让插件读取同一个环境变量：

```typescript
// packages/unplugin/src/core.ts
const mcpUrl = options.mcpUrl
    ?? (process.env.HARNESS_FE_PORT
        ? `ws://${process.env.HARNESS_FE_HOST ?? '127.0.0.1'}:${process.env.HARNESS_FE_PORT}`
        : `ws://127.0.0.1:${DEFAULT_WS_PORT}`);
```

---

## Bug #2 — Follower 模式下 Store 工具完全不可用

**严重程度**: 🟠 中  
**状态**: 根因已确认

### 现象

当 Kiro 以 follower 模式连接时，以下 10 个工具在工具列表中完全不存在：
`session.list` / `session.summary` / `session.tail` / `session.search` / `session.purge` / `project.sessions` / `project.memory.set` / `project.memory.get` / `project.memory.list` / `project.memory.delete`

### 根本原因

**三层缺失，环环相扣。**

**第一层 — 注册条件判断**（`mcp.ts:46-50`）：
```typescript
const store = (bridge as Bridge).store;
if (store != null) {
    registerStoreTools(server, store, memoryStore);
}
```
`RemoteBridge` 没有 `.store` 属性，`(bridge as Bridge).store` 返回 `undefined`。  
JavaScript 中 `undefined != null` 为 `false`（宽松不等），所以 `registerStoreTools` **永远不被调用**。

**第二层 — RemoteBridge 不支持 store 操作**（`remoteBridge.ts`）：
```typescript
getMemoryStore(): IMemoryStore {
    throw new Error('remote-bridge: getMemoryStore() is not available in follower mode');
}
```
即使绕过第一层，调用 `bridge.getMemoryStore()` 也会直接抛出异常。

**第三层 — 协议层没有 store 方法**（`messages.ts:97-103`）：
```typescript
export const mcpMethodSchema = z.enum([
    'sendCommand',
    'listTabs',
    'listTasks',
    'claimTask',
    'resolveTask',
    // store 相关方法完全缺失
]);
```
`mcp.call` / `mcp.return` 控制通道只定义了 5 个方法，没有任何 store 操作，所以即使想通过 follower→leader 代理也无法实现。

### 涉及文件

| 文件 | 行号 | 问题 |
|------|------|------|
| `packages/mcp-server/src/mcp.ts` | 46-50 | `store != null` 判断对 `undefined` 失效 |
| `packages/mcp-server/src/remoteBridge.ts` | `getMemoryStore()` | 直接抛出，无代理实现 |
| `packages/protocol/src/messages.ts` | 97-103 | `mcpMethodSchema` 缺少所有 store 方法 |

### 修复方案

在 `messages.ts` 中扩展协议，在 `RemoteBridge` 中实现代理，在 `Bridge` 中处理这些调用：

```typescript
// packages/protocol/src/messages.ts
export const mcpMethodSchema = z.enum([
    'sendCommand', 'listTabs', 'listTasks', 'claimTask', 'resolveTask',
    // 新增：
    'storeListProjects', 'storeListSessions', 'storeSummary',
    'storeTail', 'storeSearch', 'storePurge',
    'memorySet', 'memoryGet', 'memoryList', 'memoryDelete',
]);
```

---

## Bug #3 — 5 个页面工具在 Kiro 中不可见

**严重程度**: 🟡 低  
**状态**: 根因已确认

### 现象

`page.scroll`、`page.navigate`、`page.reload`、`page.set_html`、`page.set_style` 在 `mcp.ts` 中已完整注册并实现，但 Kiro 的工具列表中不存在这些工具。

### 根本原因

`.kiro/settings/mcp.json` 的 `autoApprove` 列表缺少这 5 个工具名：

```json
"autoApprove": [
    "*",              ← 通配符存在，但 Kiro 不将其解释为"批准所有"
    "tab.list",
    "page.screenshot", "project.source", "project.module_graph",
    "page.click", "project.where_is", "page.evaluate",
    "console.tail", "page.dom_query", "page.wait_for",
    "page.type",
    "page.type"       ← 重复项
    // 缺失：page.scroll, page.navigate, page.reload, page.set_html, page.set_style
    // 缺失：network.tail, errors.tail, tasks.*, session.*, project.memory.*
]
```

Kiro 的 MCP 集成在工具发现阶段会过滤 `autoApprove` 列表，`"*"` 通配符不被识别为"全部批准"，导致未列出的工具对 agent 不可见。服务器端注册完全正确，问题纯粹在客户端配置。

### 涉及文件

| 文件 | 问题 |
|------|------|
| `.kiro/settings/mcp.json` | `autoApprove` 缺少 5 个工具，`page.type` 重复 |

### 修复方案

```json
"autoApprove": [
    "tab.list",
    "page.click", "page.type", "page.evaluate", "page.wait_for",
    "page.screenshot", "page.dom_query", "page.scroll",
    "page.navigate", "page.reload", "page.set_html", "page.set_style",
    "console.tail", "network.tail", "errors.tail",
    "project.source", "project.module_graph", "project.where_is",
    "tasks.pending", "tasks.claim", "tasks.resolve"
]
```

---

## Bug #4 — `text` 选择器点击无法触发 React Router 导航

**严重程度**: 🟡 低  
**状态**: 根因已确认

### 现象

```typescript
// 失败：点击成功（返回 { via: "role-text", tag: "a" }）但路由不切换
page.click({ selector: { text: "Counter" } })

// 成功：路由正常切换
page.click({ selector: { css: "a[href='/counter']" } })
```

### 根本原因

**两个问题叠加。**

**问题 A — `matchByRoleText` 返回错误的元素**（`selectors.ts:57-70`）：

```typescript
function matchByRoleText(role?: string, text?: string): Element[] {
    const all = Array.from(document.querySelectorAll<HTMLElement>('*'));
    return all.filter((el) => {
        // ...
        if (text) {
            const elText = (el.textContent ?? '').trim();
            if (elText !== text && !elText.includes(text)) return false;
        }
        return true;
    });
}
```

`textContent` 是**累积的**——父元素的 `textContent` 包含所有子元素的文本。对于导航结构：
```html
<nav>
  <a href="/counter">Counter</a>
  <a href="/forms">Forms</a>
</nav>
```
`<nav>` 的 `textContent` 是 `"Counter Forms"`，包含 `"Counter"`，所以 `<nav>` 也会被匹配。`matchByRoleText` 返回的候选列表中，`<nav>` 排在 `<a>` 之前（DOM 顺序），`nth=0` 取到的是 `<nav>` 而非 `<a>`。

**问题 B — `target.click()` 不触发 React Router 的事件处理**（`commands.ts:27-31`）：

```typescript
[COMMAND.PAGE_CLICK]: async (raw) => {
    const args = raw as ClickArgs;
    const result = resolveSelector(args.selector);
    if (!result.element) throw new Error(describeNoMatch(args.selector));
    const target = result.element as HTMLElement;
    target.click();  // ← 问题所在
    return { via: result.via, tag: target.tagName.toLowerCase() };
},
```

`HTMLElement.click()` 触发的是一个**合成点击事件**，其 `isTrusted = false`。React Router v6 的 `<Link>` 组件在 `onClick` 处理器中会检查：
```typescript
// React Router 内部
if (event.defaultPrevented) return;
if (event.button !== 0) return;  // 只处理左键
if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
```

当目标是 `<nav>` 而非 `<a>` 时，点击事件冒泡到 `<a>` 上，但 React Router 的 `onClick` 是绑定在 `<a>` 上的，冒泡上来的事件 `target` 是 `<nav>`，React Router 的内部逻辑可能因此跳过处理。

### 涉及文件

| 文件 | 行号 | 问题 |
|------|------|------|
| `packages/runtime-client/src/selectors.ts` | 57-70 | `matchByRoleText` 用 `textContent.includes()` 导致父元素误匹配 |
| `packages/runtime-client/src/commands.ts` | 27-31 | `target.click()` 不保证触发框架路由 |

### 修复方案

**修复 A**：在 `matchByRoleText` 中改用 `innerText` 或只匹配叶子节点的直接文本：

```typescript
// packages/runtime-client/src/selectors.ts
if (text) {
    // 只匹配元素自身的直接文本，不包含子元素
    const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent ?? '')
        .join('')
        .trim();
    const fullText = (el.textContent ?? '').trim();
    if (directText !== text && fullText !== text) return false;
}
```

**修复 B**：在 `PAGE_CLICK` 中向上查找最近的 `<a>` 祖先，并派发完整的 `MouseEvent`：

```typescript
// packages/runtime-client/src/commands.ts
let clickTarget: HTMLElement = target;
if (target.tagName !== 'A') {
    const anchor = target.closest('a');
    if (anchor) clickTarget = anchor as HTMLElement;
}
clickTarget.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    view: window,
}));
```

---

## Bug #5 — `naturalHeight` 变量声明但未使用

**严重程度**: ⚪ 极低（代码质量）  
**状态**: 根因已确认

### 现象

TypeScript 编译器报告：
```
已声明"naturalHeight"，但从未读取其值。
```

### 根本原因

`commands.ts` 的 `PAGE_SCREENSHOT` handler 中：

```typescript
// packages/runtime-client/src/commands.ts
const naturalWidth  = Math.max(1, Math.round(rect.width  || target.clientWidth  || window.innerWidth));
const naturalHeight = Math.max(1, Math.round(rect.height || target.clientHeight || window.innerHeight));
//    ^^^^^^^^^^^^^ 计算了但从未使用
const width = naturalWidth > maxWidth ? maxWidth : naturalWidth;

const result = await snapdom(target as HTMLElement, {
    fast: true,
    width,           // ← 只传了 width
    // height 未传，snapdom 自动计算
    backgroundColor: format === 'jpeg' ? '#fff' : undefined,
});
```

`naturalHeight` 被计算出来但没有传给 `snapdom`，也没有用于任何其他逻辑。这是一个遗留的未完成实现——原本可能打算限制截图高度，但最终没有实现。

### 涉及文件

| 文件 | 行号 | 问题 |
|------|------|------|
| `packages/runtime-client/src/commands.ts` | `PAGE_SCREENSHOT` handler | `naturalHeight` 声明但未使用 |

### 修复方案

```typescript
// 删除未使用的变量
const naturalWidth = Math.max(1, Math.round(rect.width || target.clientWidth || window.innerWidth));
const width = naturalWidth > maxWidth ? maxWidth : naturalWidth;
```

---

## 汇总

| # | 标题 | 严重程度 | 根因文件 | 修复复杂度 |
|---|------|----------|----------|------------|
| 1 | 多标签页命令超时（端口不一致） | 🔴 高 | `unplugin/core.ts:83` | 小 — 读取环境变量 |
| 2 | Follower 模式 Store 工具不可用 | 🟠 中 | `mcp.ts:46` + `remoteBridge.ts` + `messages.ts:97` | 中 — 扩展协议 + 代理 |
| 3 | 5 个页面工具在 Kiro 不可见 | 🟡 低 | `.kiro/settings/mcp.json` | 极小 — 补全 JSON 列表 |
| 4 | `text` 选择器点击不触发 React Router | 🟡 低 | `selectors.ts:57` + `commands.ts:31` | 小 — 修选择器 + 事件派发 |
| 5 | `naturalHeight` 未使用变量 | ⚪ 极低 | `commands.ts` PAGE_SCREENSHOT | 极小 — 删一行 |
