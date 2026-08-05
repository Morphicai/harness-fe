---
"@harness-fe/runtime": patch
"@harness-fe/protocol": patch
---

fix(runtime-client): make network.idle track real in-flight requests

`page.wait_for({predicate: 'network.idle'})` was a fixed ~200ms sleep that resolved unconditionally, and `network.wait_for_idle` resolved once the network ring buffer stopped growing — which falsely reports idle the instant a request's `req` entry stops triggering new pushes, even if its `res` never arrives. Both now poll a real in-flight fetch/XHR count (derived from the buffer's req/res pairing) until it's been zero for `idleMs` (default 500). `page.wait_for` gained an `idleMs` param to match.
