---
"@harness-fe/skill": patch
"@harness-fe/gateway": patch
---

docs(skill,gateway): surface visitor_timeline earlier + document this session's tool changes

`visitor_timeline` already existed and was documented but a real multi-window Electron debugging session defaulted to manually tailing console/network per-tab before remembering it existed — a discoverability problem. Surfaced at the three places an agent looks first: `tab_list`/`visitor_timeline`'s own tool descriptions, the skill's "Mental model" section, and `docs/electron.md`'s opening (harness-fe#199).

Also documents `page.snapshot`, the new `ref` selector field, `tab_list`'s `isIframe`/`referrer`, `network_tail`'s SSE `phase: 'frame'` entries, and `session.search`'s `maxPayloadChars` in the agent skill's tool catalog.
