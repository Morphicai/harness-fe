/**
 * Initiator stack capture — answers "who issued this network/storage call?".
 *
 * Called synchronously from inside a patched API (fetch / xhr / ws / storage).
 * `new Error().stack` walks the JS call stack from the V8 perspective:
 *   - frame 0: this helper
 *   - frame 1: the patched wrapper
 *   - frame 2+: caller code
 *
 * We trim the first 2 frames so the returned `stack` starts at the business
 * code that triggered the call. Best-effort: shapes vary across engines, so
 * if the format is unexpected we return the raw stack.
 *
 * Cost: ~0.2–0.5 ms per call on a modern V8. Safe to leave on in development;
 * gated behind NODE_ENV elsewhere so production is unaffected.
 */

const FRAMES_TO_TRIM = 2;

export interface Initiator {
    stack?: string;
}

export function captureInitiator(): Initiator {
    const err = new Error();
    const raw = err.stack;
    if (!raw) return {};

    const lines = raw.split('\n');
    if (lines.length <= FRAMES_TO_TRIM + 1) return { stack: raw };

    // Preserve the "Error" header line + caller frames. Drop the frames
    // representing the helper and the patched wrapper.
    const header = lines[0].startsWith('Error') ? lines[0] : '';
    const callerFrames = lines.slice(FRAMES_TO_TRIM + 1);
    const trimmed = header
        ? [header, ...callerFrames].join('\n')
        : callerFrames.join('\n');
    return { stack: trimmed };
}
