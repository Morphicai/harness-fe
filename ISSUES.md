# morphix-dev-bridge — Known Issues

闭环测试中发现的待修复项。每条记录：现象 / 复现 / 根因猜测 / 期望行为。

---

## ISSUE-1 · `page_screenshot` 仍是 Phase A stub ✅ 2026-05-14

- **现象**：调用返回 `{ note: "page.screenshot is stubbed in Phase A. Wires snapdom in Phase C." }`，不产出图像。
- **复现**：连接任意 tab，调 `mcp__morphix-dev-bridge__page_screenshot`。
- **根因**：runtime 客户端里 `page.screenshot` 处理器只占位，未接 snapdom。
- **修复**：runtime-client 引入 `@zumer/snapdom@^2.12`，selector 命中元素或 `document.documentElement` 全屏 → `snapdom().toCanvas() → canvas.toDataURL()`；返回 `{ via, format, width, height, dataUrl }`。`maxWidth` 默认 1280，jpeg/webp 质量 0.85。
- **优先级**：P1（视觉反馈是闭环里最直观的一环）。

---

## ISSUE-2 · `project_module_graph` / `project_where_is` 只识别顶层组件声明 ✅ 2026-05-14

- **现象**：`react-demo` 里页面上明明能用 selector `{component: "IncrementBtn"}` / `EchoInput` 命中，但
  - `project_module_graph` 只返回 `App`（`totalFiles: 1`）。
  - `project_where_is({component: "IncrementBtn"})` 直接报 `not found`。
- **复现**：
  ```ts
  page_dom_query({css: "button"})            // 可以看到 data-morphix-comp="IncrementBtn"
  project_where_is({component: "IncrementBtn"}) // not found
  ```
- **根因**：Vite 插件 AST 扫描只识别 `function FooBar()` / `const FooBar = ...` 这类顶层组件声明，没有把源码里出现的 `data-morphix-comp="..."` 标签也收进 component map。运行时 selector（DOM 端）和静态 where_is（AST 端）目前是两套来源、口径不一致。
- **修复**：`transformJsx` 新增 `getStringAttribute` helper，扫到 JSX 上手写的 `data-morphix-comp="X"` 时同步把 `X` 注册进 componentMap（保留 enclosing 组件注册）。现在 `IncrementBtn / ResetBtn / EchoInput / EchoDisplay / CounterValue` 都能被 `project_where_is` 命中。
- **优先级**：P1（动态 selector 与静态定位失配，会让 AI 在"我能点到 → 我能跳到源码"之间断链）。

---

## ISSUE-3 · 页面标注 → Agent 认领闭环（已实现 MVP，跟踪后续打磨）

- **现状**：runtime-client 注入 Shadow DOM 浮标，picker 选元素 + 输入问题 → daemon `tasks` Map 排队 → 新增 `tasks_pending / tasks_claim / tasks_resolve` 三个 MCP 工具。
- **MVP 范围内已覆盖**：
  - 右下角 FAB 唤起 / ESC 取消
  - 鼠标 hover 蓝色描边 + click 锁定
  - 复用 `data-morphix-comp` / `data-morphix-loc`，提交时同时附 CSS 路径回退
  - element.outerHTML 截 2KB，rect 一并附带
- **待补 / 已知限制**：
  1. ~~没有元素截图（依赖 ISSUE-1 接 snapdom）~~ ✅ ISSUE-1 已修，runtime 端 selector 截图已可用
  2. ~~daemon 重启即丢任务~~ ✅ 2026-05-14：Bridge 新增 `tasksFile`（默认 `<tmpdir>/morphix-dev-bridge-tasks.json`，可由 `MORPHIX_DEV_BRIDGE_TASKS_FILE` 覆盖；空字符串禁用），每次 record/claim/resolve 落盘，启动时加载
  3. ✅ 按设计如此：MCP 是 pull 模型，不做反向推送。runtime 把标注塞进持久化队列即可，用户在 Claude Code 主动说一句"看看任务" → Agent 用 `tasks_pending / tasks_claim / tasks_resolve` 自取自结。
  4. ✅ 2026-05-14：`buildCssPath` 深度上限 6 → 12（遇 `id` 仍然短路提前停）；新增 shadow DOM 穿透——遇 ShadowRoot 边界时关闭当前段、从 `shadowRoot.host` 继续，段间用 ` >>> ` 标记（非合法 CSS 组合子，作为给 Agent 的边界提示）。覆盖 4 条单测（happy-dom env）。
  5. ~~同一 tab 多次提交没去重~~ ✅ 2026-05-14：dedup key = `tabId::(loc∨comp∨css)::question.trim()`，同 key 的 pending 任务只刷新 timestamp/element，不创建新条目
- **优先级**：P2（功能已通，体验/可靠性慢慢打磨）。**全部小项已收口**。

---

## 测试覆盖快照（2026-05-14 闭环跑通）

| 工具 | 状态 |
|---|---|
| tab_list | ✅ |
| console_tail | ✅ |
| errors_tail | ✅ |
| network_tail | ✅ |
| page_click | ✅ |
| page_type | ✅ |
| page_dom_query | ✅ |
| page_evaluate | ✅ |
| page_wait_for | ✅（`dom.ready` 内建谓词） |
| page_screenshot | ✅ snapdom (ISSUE-1 ✓) |
| project_source | ✅ |
| project_module_graph | ✅ 含手写 comp 标签 (ISSUE-2 ✓) |
| project_where_is | ✅ 含手写 comp 标签 (ISSUE-2 ✓) |
