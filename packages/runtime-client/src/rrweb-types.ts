/**
 * Pure helpers around rrweb event types — no rrweb import.
 *
 * rrweb itself is browser-only and dies on import in Node test contexts
 * (transitively requires `document`/CommonJS shenanigans), so we keep
 * anything that needs to be unit-testable in a separate module.
 */

/** rrweb event types: 2 = FullSnapshot baseline. */
export const RRWEB_FULL_SNAPSHOT_TYPE = 2;

/** True if any event in the chunk is an rrweb FullSnapshot (type:2). */
export function chunkHasFullSnapshot(chunk: { events: readonly unknown[] }): boolean {
    for (const ev of chunk.events) {
        if (
            ev &&
            typeof ev === 'object' &&
            (ev as { type?: unknown }).type === RRWEB_FULL_SNAPSHOT_TYPE
        ) {
            return true;
        }
    }
    return false;
}
