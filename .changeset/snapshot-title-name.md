---
'@harness-fe/runtime': patch
---

`page.snapshot` now reports a button's `title` alongside `aria-label`. Icon-only
buttons are everywhere in real UIs and frequently carry their only
human-readable name in `title`, so the snapshot was returning a wall of
`text: ""` entries an agent could not pick a target from.
