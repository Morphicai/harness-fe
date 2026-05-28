# Overlay 插件

页面内的 "H" overlay 是可扩展的。一个**插件**给信息卡加一个动作按钮;点击会带着一个类型化 context 跑你的 handler,这个 context 按需提供当前场景、日志、截图和被选元素。用它把当前情况发给队友,或 POST 进你自己的系统(issue tracker、Slack、webhook)。

> 仅 dev 期。运行时(以及 overlay 和你的插件)只在 development 构建中加载——生产环境零开销。

## 注册插件

注册顺序不重要:注册表会缓冲,集合变化时 overlay 重新渲染——所以页面加载之后再注册按钮依然会出现。

### A. 类型化 import(推荐)

`@harness-fe/runtime` 已经在(打包器插件注入了),命名 import 是幂等的。能拿到完整类型:

```ts
// src/harness-plugins.ts —— 在应用入口 import 一次
import { registerOverlayPlugin, type OverlayPluginContext } from '@harness-fe/runtime';

if (import.meta.env.DEV) {
  registerOverlayPlugin({
    id: 'send-to-slack',
    label: 'Send to Slack',
    async onClick(ctx: OverlayPluginContext) {
      await fetch('/api/harness/share', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          md: ctx.snapshotMarkdown(),
          logs: ctx.getLogs({ errors: 20, network: 20 }),
        }),
      });
      ctx.toast('Sent to Slack');
    },
  });
}
```

`registerOverlayPlugin` 返回一个 unregister 函数——便于 HMR 清理。

### B. 零 import 全局

启动后 `window.HarnessFE` 可用。如果你的脚本可能在运行时加载*之前*运行,改向 pre-boot 队列推:

```html
<script type="module">
  window.HarnessFE.registerOverlayPlugin({ id: 'x', label: 'X', onClick(ctx) { /* … */ } });
</script>

<!-- 在运行时之前跑:启动时被消费 -->
<script>
  (window.__HARNESS_FE_PLUGINS__ ||= []).push({ id: 'x', label: 'X', onClick(ctx) { /* … */ } });
</script>
```

## 插件形状

```ts
interface OverlayPlugin {
  id: string;                 // 唯一;重新注册同 id 会覆盖
  label: string;              // 按钮文字
  icon?: string;              // 可选的前导 emoji/字符
  requiresElement?: boolean;  // 点击先进入元素选择模式
  onClick(ctx: OverlayPluginContext): void | Promise<void>;
}
```

`requiresElement` 为 `true` 时,点击按钮进入元素选择器;用户点的元素以 `ctx.selectedElement` 提供给你。

## context 暴露什么

```ts
interface OverlayPluginContext {
  // 身份 / 场景(同步)
  projectId; displayName?; buildId?; parentProjectId?;
  sessionId; tabId; visitorId?; userId?;
  url; connectionState; dashboardUrl?;   // 本 session 的深链接
  selectedElement?;                      // requiresElement 插件会有

  snapshotMarkdown(): string;            // 可分享的 markdown 摘要
  snapshot(): PageLoadPayload;           // 页面 / 视口 / 存储 / 性能
  getLogs(opts?): { console; network; errors };   // 最近缓冲的日志
  captureScreenshot(el?): Promise<TaskAttachment | null>;  // PNG(base64)
  query?(method, args?): Promise<…>;     // daemon RPC(如 'tasks.mine')

  copyToClipboard(text): Promise<void>;
  toast(message, kind?): void;           // 'ok' | 'error'
}
```

### `getLogs` 脱敏

`getLogs` 默认返回空——传计数才包含条目:

```ts
ctx.getLogs({ console: 50, network: 20, errors: 20 });
```

网络条目**默认脱敏**:请求/响应 body 被丢弃,`authorization` / `cookie` header 被剥离。传 `redact: false` 拿到原始条目——仅当你控制目的地时:

```ts
ctx.getLogs({ network: 20, redact: false }); // 包含 body + 所有 header
```

::: warning 敏感数据
`snapshot().storage`(localStorage / sessionStorage / cookie)和 `userId` 是真实用户数据。别盲目发给第三方。网络 body/header 默认脱敏正是这个原因。
:::

## 示例:创建 Jira issue

浏览器不能跨域调 Jira Cloud REST API,Jira token 也绝不能存在页面 JS 里。所以插件把组装好的 context POST 到**你自己的代理端点**,由它带服务端凭证转发给 Jira。(形状跟通用的 "发到我的系统" webhook 一样。)

```ts
import { registerOverlayPlugin } from '@harness-fe/runtime';

registerOverlayPlugin({
  id: 'jira',
  label: 'Create Jira issue',
  requiresElement: true,
  async onClick(ctx) {
    const shot = await ctx.captureScreenshot(ctx.selectedElement?.el);
    const res = await fetch('/api/harness/jira', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectKey: 'ENG',
        issueType: 'Bug',
        summary: `[harness] ${ctx.selectedElement?.selector.comp ?? ctx.url}`,
        description: ctx.snapshotMarkdown(),
        labels: ['harness-fe'],
        selector: ctx.selectedElement?.selector,
        env: ctx.snapshot(),
        logs: ctx.getLogs({ network: 20, errors: 20 }),
        dashboardUrl: ctx.dashboardUrl,
        screenshotPng: shot?.data, // base64 PNG,服务端 attach
      }),
    });
    ctx.toast(res.ok ? 'Jira issue created' : 'Failed to create issue', res.ok ? 'ok' : 'error');
  },
});
```

### 代理契约

你的 `/api/harness/jira` 收到上面的 JSON,负责调 Jira REST(`POST /rest/api/3/issue`,然后通过 `/rest/api/3/issue/{key}/attachments` attach `screenshotPng`),使用服务端持有的 token。把 token 留在服务端就是整个目的——绝不要嵌入到插件里。
