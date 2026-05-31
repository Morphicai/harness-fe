---
'@harness-fe/daemon': minor
'@harness-fe/mcp-server': minor
'@harness-fe/gateway': minor
---

Project→agent binding — make the team (multi-user) path actually usable.

Before this, a gateway token bound only to a *server* (daemon), and the daemon
isolated data by *who created each row* (`createdBy`). In a team setup the
runtime that creates a session and the agent that reads it are different
principals, so `canSeeProject` filtered everything out: an agent through the
gateway saw **zero** sessions and couldn't drive any tab (`creator ≠ consumer`).

Now authorization is by **project membership**, injected end to end:

- **gateway** — a token carries `projects` (`['*']` = all, or a specific list).
  `harness-gateway --issue-token name=…,server=…,scopes=…,projects=react-demo`.
  The proxy forwards the grants to the daemon via a new `x-harness-projects`
  header (companion to `x-harness-caller`); no list ⇒ `*`.
- **daemon** — `Principal` gains `projects`; `identifyPrincipal` reads the
  forwarded grants. New `projectGrant(principal, projectId)` (local → all,
  explicit grants → membership, none → `null` = fall back to creator-based).
  `canSeeProject(principal, projectId, ownerChain)` and `findTab` (command-target
  scoping) honour grants first, then fall back to `createdBy` — so **solo /
  single-token behaviour is unchanged** while a bound agent sees a project's
  whole data set and can drive its tabs regardless of who created the data.

Verified live through the gateway with a `projects=react-demo` token: the agent
now lists react-demo sessions (was empty), is denied an un-granted project
(`some-other-app` → empty), and `page.click` reaches the tab and triggers the
browser consent gate (was unreachable). New unit tests cover `projectGrant` and
the grant/fallback paths in `canSeeProject`.
