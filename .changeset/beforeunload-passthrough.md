---
"@harness-fe/sandbox": patch
---

fix(sandbox): stop suppressing beforeunload — agent-triggered navigation no longer shows a native "Leave site?" dialog (#185)

The `beforeunload` listener called `e.preventDefault()` when an agent command was in progress, with a comment claiming this "suppresses" the dialog. Per the HTML spec, `preventDefault()`/`returnValue` is the *only* way to ASK the browser to show its native "unsaved changes" confirmation — there is no way to cancel that dialog from JS once triggered. So every agent-triggered `page.reload()` / `page.navigate()` call was itself causing the browser to pop this unsuppressible native dialog, even on pages with no unsaved-state concerns. The listener now only emits the `beforeunload` telemetry event and leaves the event completely untouched; app-registered `beforeunload` listeners (if any) are unaffected and remain free to call `preventDefault()` themselves.
