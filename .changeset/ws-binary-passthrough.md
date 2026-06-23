---
"@harness-fe/sandbox": patch
---

fix(sandbox): never replace outgoing binary WebSocket frames with their timeline marker (#180)

The WS `send` patch fed the lossy serialized frame (e.g. `"[binary ArrayBuffer 123B]"`, used only for the timeline) back onto the wire for binary payloads, because it inferred "an interceptor rewrote this" from `current !== data` — always true for binary. This corrupted every binary WebSocket protocol (Agora RTM/RTC, LiveKit, Twilio, protobuf-over-ws), e.g. RTM login failing with `-10023`, hang-ups not dismissing, and lost in-call signaling. Now an explicit `rewritten` flag gates the override: the original `data` is always transmitted untouched unless an `onSend` interceptor explicitly returns a replacement string. Observation/timeline behaviour is unchanged.
