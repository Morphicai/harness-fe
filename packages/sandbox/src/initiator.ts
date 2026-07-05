/**
 * Initiator stack capture — answers "who issued this call?".
 *
 * Called synchronously from inside a patched API. `new Error().stack` walks
 * the JS call stack; we trim the first N frames so the result starts at the
 * business code that triggered the call.
 *
 * Cost: ~0.2–0.5 ms per call on a modern V8.
 *
 * Safety: every call wrapped in try/catch — failure returns an empty Initiator,
 * never throws.
 */

import type { Initiator } from './types.js';

const DEFAULT_FRAMES_TO_TRIM = 2;

export function captureInitiator(framesToTrim = DEFAULT_FRAMES_TO_TRIM): Initiator {
    try {
        const err = new Error();
        const raw = err.stack;
        if (!raw) return {};

        // `new Error().stack` always starts with the literal "Error" header
        // line, regardless of outcome — it is never meaningful here (this is
        // a call-site capture, not a real error), so it is always dropped.
        const lines = raw.split('\n').slice(1);
        const callerFrames = lines.length <= framesToTrim ? lines : lines.slice(framesToTrim);
        return { stack: callerFrames.join('\n') };
    } catch {
        return {};
    }
}
