---
"@harness-fe/cli": patch
---

fix(cli): forward --experimental-env-var to spawned shared gateway

`harness mcp --experimental-env-var HARNESS_FE_ENABLE` was silently ignored:
the flag was parsed but never passed to `ensureSharedGateway`, so the spawned
`harness serve` process started without the gate — experimental tools were
always enabled regardless of the env var. Adds `experimentalEnvVar` to
`EnsureSharedGatewayOptions` and appends `--experimental-env-var` to the
spawn args when provided.
