---
'@harness-fe/runtime': patch
---

`page.dom_query` no longer reports a phantom duplicate match. The css sweep and
the `resolveSelector` fallback routinely land on the same node, and both were
pushed, so a page with one `<textarea>` reported two matches and 14 `<button>`s
reported 15 — making `matches.length` unusable as a count. Matches are now
deduped by element identity.
