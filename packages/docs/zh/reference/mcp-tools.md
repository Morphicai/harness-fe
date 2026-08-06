# MCP Tools

MCP daemon 暴露 45+ 工具,按功能分组,可从任何支持 MCP 的 Agent(Claude Code、Cursor、Kiro、Windsurf…)调用。

::: info 权限范围与 consent(4.0)
**单人**(loopback)模式下所有工具无门控可用。治理[团队模式](/zh/guide/team-mode)更严格:网关**按 token scope 过滤 `tools/list`**(read-only token 根本看不到 `page.*`)、拒绝越权调用(`-32001 scope denied`),并把 `control` 命令(`page.*`)运行在 [consent 门控](/zh/guide/consent)之后。`page.evaluate` 始终提示。
:::

## 安装 Agent playbook

学习完整工具集最快的方式是装 `@harness-fe/skill`:

```bash
npx @harness-fe/skill install
```

它会把一份 `SKILL.md` 投放到你的 Agent 项目中,包含完整工具目录、心智模型、决策流和使用示例。

## 工具分组

### 身份与拓扑

| 工具 | 说明 |
|------|-------------|
| `tab.list` | 列出已知 tab 及其 project、session 和 URL |
| `project.list` | 列出 daemon 见过的所有 project |
| `project.tree` | 项目层级(微前端的 parent → child) |
| `dashboard.open` | 返回(并可选打开)dashboard URL |

### 页面交互

| 工具 | 说明 |
|------|-------------|
| `page.navigate` | 在活动 tab 中导航到 URL |
| `page.click` | 按 selector 点击元素 |
| `page.type` | 向元素键入文本 |
| `page.scroll` | 滚动页面或元素 |
| `page.screenshot` | 截图(返回 base64 PNG) |
| `page.dom_query` | 查询 DOM 元素并返回其属性 |
| `page.evaluate` | 在页面上下文中跑任意 JS |
| `page.wait_for` | 等待元素或条件 |
| `page.set_html` | 替换元素的 innerHTML |
| `page.set_style` | 注入或覆盖 CSS |
| `page.reload` | 重新加载当前页 |

### 遥测

| 工具 | 说明 |
|------|-------------|
| `console.tail` | 最近 N 条 console 日志(log/warn/error) |
| `network.tail` | 最近 N 条网络记录。`phase: req\|res\|frame`（frame 是从 `text/event-stream` 响应体 tee 出来的 SSE 帧，存放在独立的深 ring 里）。过滤条件作用于整个 buffer，再取最新 N 条匹配；返回里带 `matched` / `truncated` / `dropped` |
| `network.get` | 单个请求按 ID 取完整详情 —— 包含该请求保留的全部 SSE 帧（按顺序，`maxFrames` 可限量） |
| `ws.tail` | 最近 N 个 WebSocket 帧 |
| `ws.get` | 单个 WS 帧的完整详情 |
| `errors.tail` | 最近 N 个未处理错误 |
| `session.tail` | 原始时间线切片——所有事件类型 |
| `session.summary` | session 元数据 + 事件计数 |
| `session.list` | 列出项目的 session |

### 等待与空闲

| 工具 | 说明 |
|------|-------------|
| `network.wait_for` | 等待匹配 pattern 的网络请求 |
| `network.wait_for_idle` | 等到没有 in-flight 请求 |

### 回放与取证

| 工具 | 说明 |
|------|-------------|
| `session.recordings.list` | 列出 session 的 rrweb 录制 chunk |
| `session.recordings.slice` | 返回与时间窗重叠的 chunk |
| `session.replay.create` | 将 chunk 打包为可分享的 rrweb player URL |

### 源码情报

| 工具 | 说明 |
|------|-------------|
| `project.where_is` | 定位组件或源文件——返回文件路径 + 行号 |
| `project.source` | 从项目树读源文件 |
| `project.module_graph` | 项目的 AST 派生组件图 |

### Visitor journey

| 工具 | 说明 |
|------|-------------|
| `visitor.list` | 列出已知 visitor |
| `visitor.get` | visitor 元数据 |
| `visitor.journey` | visitor 的有序 session 链 |
| `visitor.timeline` | visitor 跨 tab 合并的事件时间线 |

### 项目 memory

| 工具 | 说明 |
|------|-------------|
| `project.memory.set` | 给项目写一条持久 key/value memory |
| `project.memory.get` | 读一条 memory |
| `project.memory.list` | 列出项目的所有 memory |
| `project.memory.delete` | 删除 memory |

### Build 与存储

| 工具 | 说明 |
|------|-------------|
| `build.list` | 列出项目的 build |
| `build.get` | build 元数据 |

## Selector 语法

多数页面交互工具接受一个 `selector` 对象:

```jsonc
// 按 CSS
{ "css": "button.submit" }

// 按组件名(源码感知——需要构建插件)
{ "comp": "SubmitButton" }

// 按源位置
{ "loc": "src/components/SubmitButton.tsx:42" }

// 按可见文本
{ "text": "Submit order" }

// 组合提精度
{ "comp": "CartBadge", "css": "button" }
```

`comp:` 和 `loc:` 形式仅在构建插件对源码做过插桩时可用。

## 延伸阅读

- [安装 playbook](https://www.npmjs.com/package/@harness-fe/skill) —— `npx @harness-fe/skill install`
- [Overlay 插件](/zh/reference/overlay-plugins) —— 扩展页面内的 H 按钮
