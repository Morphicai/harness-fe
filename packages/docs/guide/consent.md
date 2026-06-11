# Consent & runtime control

Reading telemetry is harmless. **Driving** the page (`page.click`, `page.type`,
`page.evaluate`, …) is not — so in 4.0 control commands run behind a consent gate.
This page covers the app-level default and the user's runtime opt-in that sits on
top of it.

## The default is `deny`

In 4.0 the secure default flipped: control commands are **rejected** unless
someone opts in. An app declares its default with the `consent` option on the
build plugin / `<HarnessScript>`:

| Mode | Behaviour |
|---|---|
| `deny` **(default)** | All control commands rejected immediately — no prompt. |
| `off` | No prompt; control runs freely. Loopback / solo dev convenience. |
| `session` | Ask the user once per page-load, then remember for the session. |
| `always` | Prompt before every control command. |

```ts
harnessFE({ projectId: 'my-app', consent: 'off' })       // solo: run freely
harnessFE({ projectId: 'my-app', consent: 'session' })   // ask once per load
```

`page.evaluate` (arbitrary JS) **always** prompts, regardless of mode.

In governed [team mode](./team-mode.md), the gateway forces `session` for its
peers, so a shared deployment never silently allows control.

## Runtime opt-in (the user's final say)

The app default is just a default. The **end-user** can allow or block agent
control for an app directly from the in-page overlay — a one-tap toggle in the
info card. Their choice is persisted in `localStorage`
(`__hfe_runtime_control__:{projectId}`) and **overrides** the app default and the
gateway default.

This closes the gap where a user had no way to refuse: even if an app ships
`consent: 'off'`, the user can flip control off and it stays off across reloads.

Programmatic access (e.g. to build your own toggle):

```ts
window.HarnessFE.getRuntimeControl()        // 'allow' | 'ask' | 'deny'
window.HarnessFE.setRuntimeControl('deny')  // persist + re-gate immediately
```

## Resolution order

The effective gate is resolved highest-priority first:

```
user choice (localStorage)  →  app `consent` option  →  gateway default  →  deny
```

So: a user `deny` always wins; otherwise the app's `consent` decides; otherwise
the governed gateway's mode; otherwise the secure `deny` fallback.

> A future `runtimeControl: { scopes }` option will let an app additionally
> declare *which* capabilities an agent may use (e.g. read-only, no `evaluate`) —
> a dimension `consent` alone can't express. See the
> [per-app control policy design](https://github.com/Morphicai/harness-fe/blob/main/docs/design/per-app-control-policy.md).
