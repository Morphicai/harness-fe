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

        const lines = raw.split('\n');
        if (lines.length <= framesToTrim + 1) return { stack: raw };

        const header = lines[0]?.startsWith('Error') ? lines[0] : '';
        const callerFrames = lines.slice(framesToTrim + 1);
        const trimmed = header
            ? [header, ...callerFrames].join('\n')
            : callerFrames.join('\n');
        return { stack: trimmed };
    } catch {
        return {};
    }
}
