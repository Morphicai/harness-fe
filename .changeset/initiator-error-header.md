---
"@harness-fe/sandbox": patch
---

fix(sandbox): stop prepending the literal "Error" header to captured initiator stacks (#179)

`captureInitiator()` always prepended `new Error().stack`'s first line — which is always the literal string `"Error"`, regardless of outcome, since this captures a call site rather than a real error. Every `initiator.stack` shown in a network/storage/navigation/globals/indexeddb inspector was therefore prefixed with a misleading `"Error\n    at ..."`, making a perfectly healthy call look like a failure. The header is now dropped unconditionally; short-stack fallback behavior also no longer leaks it.
