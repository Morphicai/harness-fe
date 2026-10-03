# Developing and inspecting the console

Current sources: packages/console-ui/vite.config.ts and packages/cli/src/cli.ts. The console is a React/Vite app served under /console by the gateway; local Vite development uses port 5175.

```bash
pnpm --filter @harness-fe/console-ui dev
```

Start or select the intended gateway separately using its normal CLI/configuration. Its user/project policy, API target and backing stores must match the intended development scenario. Use [the architecture guide](architecture.md) and the package's actual connection/route code when correlating UI requests.

## What this command proves

The current console Vite config includes the React plugin. It does not install Harness instrumentation or automatically add a recorder/FAB to the console itself. Therefore starting console development is not proof that an Agent can drive or record that page via Harness.

If console self-instrumentation is desired, treat it as a separate runtime integration with explicit plugin/runtime configuration and acceptance evidence. Do not run the absent pnpm dev:self-debug script or install a removed dashboard-ui/mcp-server package to follow the old recipe.

Use existing UI/debug tools against the development gateway and scope; retain only necessary, sanitized reproduction evidence. This documentation pass did not start a server, record a session or change user data.

The full [3.x self-debug recipe](https://github.com/Morphicai/harness-fe/blob/main/docs/archive/self-debug-3x.md) remains historical evidence. Its ports, auto-injection and storage promises are not current instructions.
