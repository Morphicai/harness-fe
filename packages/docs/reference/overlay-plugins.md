# Overlay plugins

The in-page "H" overlay is extensible. A **plugin** adds an action button to the
info card; clicking it runs your handler with a typed context that gives
on-demand access to the current scene, logs, a screenshot, and the picked
element. Use it to send the current situation to a teammate, or POST it into your
own system (issue tracker, Slack, webhook).

> Dev-only. The runtime (and therefore the overlay and your plugins) ships only
> in development builds — there is zero production footprint.

## Registering a plugin

Registration order doesn't matter: the registry buffers, and the overlay
re-renders when the set changes — so registering after the page has loaded still
shows the button.

### A. Typed import (recommended)

`@harness-fe/runtime` is already present (the bundler plugin injects it), and the
named import is idempotent. You get full types:

```ts
// src/harness-plugins.ts — import once from your app entry
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

`registerOverlayPlugin` returns an unregister function — handy for HMR cleanup.

### B. Zero-import global

After boot, `window.HarnessFE` is available. If your script might run *before*
the runtime loads, push onto the pre-boot queue instead:

```html
<script type="module">
  window.HarnessFE.registerOverlayPlugin({ id: 'x', label: 'X', onClick(ctx) { /* … */ } });
</script>

<!-- runs before the runtime: drained on boot -->
<script>
  (window.__HARNESS_FE_PLUGINS__ ||= []).push({ id: 'x', label: 'X', onClick(ctx) { /* … */ } });
</script>
```

## Plugin shape

```ts
interface OverlayPlugin {
  id: string;                 // unique; re-registering an id replaces it
  label: string;              // button text
  icon?: string;              // optional leading emoji/char
  requiresElement?: boolean;  // click first enters element-picker mode
  onClick(ctx: OverlayPluginContext): void | Promise<void>;
}
```

When `requiresElement` is `true`, clicking the button enters the element picker;
the element the user clicks is delivered as `ctx.selectedElement`.

## What the context exposes

```ts
interface OverlayPluginContext {
  // identity / scene (sync)
  projectId; displayName?; buildId?; parentProjectId?;
  sessionId; tabId; visitorId?; userId?;
  url; connectionState; dashboardUrl?;   // deep link to this session
  selectedElement?;                      // present for requiresElement plugins

  snapshotMarkdown(): string;            // shareable markdown summary
  snapshot(): PageLoadPayload;           // page / viewport / storage / performance
  getLogs(opts?): { console; network; errors };   // recent buffered logs
  captureScreenshot(el?): Promise<TaskAttachment | null>;  // PNG (base64)
  query?(method, args?): Promise<…>;     // daemon RPC (e.g. 'tasks.mine')

  copyToClipboard(text): Promise<void>;
  toast(message, kind?): void;           // 'ok' | 'error'
}
```

### `getLogs` redaction

`getLogs` returns nothing by default — pass counts to include entries:

```ts
ctx.getLogs({ console: 50, network: 20, errors: 20 });
```

Network entries are **redacted by default**: request/response bodies are dropped
and `authorization` / `cookie` headers are stripped. Pass `redact: false` to get
raw entries — only when you control the destination:

```ts
ctx.getLogs({ network: 20, redact: false }); // includes bodies + all headers
```

::: warning Sensitive data
`snapshot().storage` (localStorage / sessionStorage / cookie) and `userId` are
real user data. Don't blindly ship them to third parties. Network bodies/headers
are redacted by default for exactly this reason.
:::

## Example: create a Jira issue

Browsers can't call the Jira Cloud REST API cross-origin, and a Jira token must
never live in page JS. So the plugin POSTs the assembled context to **your own
proxy endpoint**, which forwards to Jira with server-side credentials. (This is
the same shape as a generic "send to my system" webhook.)

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
        screenshotPng: shot?.data, // base64 PNG, attach server-side
      }),
    });
    ctx.toast(res.ok ? 'Jira issue created' : 'Failed to create issue', res.ok ? 'ok' : 'error');
  },
});
```

### Proxy contract

Your `/api/harness/jira` receives the JSON above and is responsible for the Jira
REST call (`POST /rest/api/3/issue`, then attach `screenshotPng` via
`/rest/api/3/issue/{key}/attachments`) using a server-held token. Keeping the
token server-side is the whole point — never embed it in the plugin.
