# Design: Per-app control policy

> Status: **design / proposal** (does not block the 4.0 closeout). The 4.0
> `runtime opt-in` work implements the first layer of this; the rest is staged.

## Problem

One daemon / gateway can serve many apps (projects). Different apps want
different defaults for **how much an agent is allowed to consume** — one app is
fine with an agent driving the page freely, another wants every control command
confirmed, a third (a payment flow) wants control denied outright. Today there
is no per-app way to express this: the policy is effectively global per
deployment.

The question this answers: *how do we let each app declare its own control
policy, let an operator override it, let the end-user have the final say, and
keep all of that extensible?*

## Current model (why per-app doesn't exist yet)

Authorization today is **token → app**, one-directional:

- A gateway token carries `scopes` (read/control/write) + `projects` (grants) +
  `expiresAt`. It says *what the holder may do and which apps it may touch*.
- An app (`ProjectMeta`: `id` / `displayName` / `tags` / `parentProjectId` /
  `createdBy`) carries **no policy** — it does not say *how it wants to be
  consumed*.
- The only per-deployment lever is the plugin's `consent` mode (off / session /
  always / deny), which is not per-app and not user-overridable.

So a token defines which apps it can consume; an app cannot define how it may be
consumed. Per-app control policy is the missing reverse direction.

## Design: a three-source policy, resolved at the gate

Make the **effective control policy** a resolution of three sources, highest
precedence first:

1. **End-user choice** (browser `localStorage`, per origin+project) — the user
   actively opts in/out of agent control. Final say for control. Key pattern
   reuses the existing `__hfe_consent_grant__:{projectId}` → a new
   `__hfe_runtime_control__:{projectId}`.
2. **Operator / gateway override** (per-project, server-side) — in team mode one
   gateway serves many apps; an operator can override an app's declared default
   without touching its build. Stored alongside the gateway's per-project state.
3. **App-declared default** (build plugin) — the app author's intent, shipped in
   the bundle: `runtimeControl: { defaultPolicy: 'ask' | 'allow' | 'deny', scopes? }`,
   injected via `window.__HARNESS_FE__` (same channel as `consent`).

Below all three, the global fallback is **deny** (secure default, matches the
4.0 consent-deny default).

```
effective = userChoice ?? gatewayOverride ?? appDefault ?? 'deny'
```

### App attributes (optional driver of the default)

Rather than every app hand-writing a policy, let an app's **attributes** derive
one. Add policy-relevant fields to the project model (or a sibling per-project
policy record so `ProjectMeta` stays lean):

- `env`: `dev | staging | prod` — e.g. `prod` ⇒ default `deny`.
- `trust`: `trusted | exposed` — exposed apps default stricter and (in 5.0)
  require real-user binding.
- `controlProfile`: a named bundle of (defaultPolicy + allowed scope subset) so
  many apps can share one profile instead of repeating settings.

The existing `tags` field is the cheap first home for this if we don't want a
schema change yet (e.g. `tags: ['env:prod', 'trust:exposed']`), with a documented
mapping `tags → policy`.

### One resolver, many call sites

All consumers (runtime gate, gateway, future admin UI) go through a single pure
function so new dimensions are added in one place:

```ts
resolveControlPolicy({
  command,            // which control command is being attempted
  appDefault,         // from the bundle
  gatewayOverride,    // from the gateway store (team)
  userChoice,         // from localStorage (browser)
  attributes,         // env / trust / profile, if present
}): 'allow' | 'ask' | 'deny'
```

This composes with — does not replace — the existing P2 `requiresConsent(cmd,
mode, sessionGranted)`: `resolveControlPolicy` decides the *mode*, `requiresConsent`
decides whether *this command* needs a prompt under that mode.

### How "different apps consume tokens differently" falls out

The token still carries capability (scope + grants). The app now carries
*willingness* (control policy). They meet at the resolver: the **same** agent
token, holding `control` scope, can drive app A (policy `allow`), must get
in-page approval on app B (policy `ask`), and is rejected on app C (policy
`deny`) — without any per-token change. That is the per-app differentiation.

## Extensibility / adaptation

- **Front-end (app author):** `runtimeControl` plugin option (declares default).
- **Back-end (operator):** gateway per-project policy + an admin endpoint to set
  overrides; ROADMAP's `GatewayPlugin` interface is the hook for shipping policy
  sources/adapters out-of-tree.
- **Protocol:** extend the P2 `ConsentPolicy` into a richer `ControlPolicy`
  (defaultPolicy + allowed scopes) carried on `hello.ack` so a governed gateway
  can push per-project policy to the runtime.
- **New dimension (e.g. time-window, route-level "don't record this page"):** add
  a field to the policy schema + a clause in `resolveControlPolicy`; call sites
  unchanged.

## Staging (maps onto the roadmap)

- **4.0 (in progress, `runtime opt-in`)** — layer 3 (app-declared default) +
  layer 1 (user `localStorage` choice) + overlay toggle. This is the foundation
  and ships in the 4.0 closeout. No new app-attribute schema required (uses the
  plugin option).
- **Post-4.0** — layer 2 (gateway per-project override + admin endpoint) and the
  attribute-driven defaults (`env` / `trust` / `controlProfile`), plus the
  `ConsentPolicy → ControlPolicy` protocol extension.
- **5.0** — tie `trust: exposed` to real-user binding (`verifyUser`) and token
  delivery hardening; policy sources shipped as `GatewayPlugin`s.

## Open questions

- Schema vs tags: do we add first-class `env`/`trust`/`controlProfile` to
  `ProjectMeta`, or keep deriving from `tags` until the profile set stabilizes?
- Override precedence in adversarial cases: can an operator override force
  `allow` over a user's `deny`? (Proposed: no — user `deny` is always final for
  in-page control; operator can only tighten, not loosen, what the user sees.)
- Where does the per-project gateway override live — in the token store, a new
  project-policy store, or the project meta itself?
