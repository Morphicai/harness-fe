---
"@harness-fe/core": minor
---

Project visibility default-deny (4.0 security gate) — a scoped gateway token
(`token` / `forwarded`) with no explicit project grants can no longer enumerate
or read projects through the unowned-data backward-compat path. `canSeeProject`
now requires a scoped caller to actually own a project (its id in the owner
chain); unowned/legacy rows are not enumerable by an unbound token. The
`projectList` / `projectGet` / `projectTree` capabilities — previously unfiltered
— now filter by visibility. `local` / `host` (unrestricted) callers and tokens
with explicit project grants are unaffected; solo behaviour is unchanged.
