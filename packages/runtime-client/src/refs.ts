/**
 * Element refs for page.snapshot (harness-fe#202).
 *
 * A snapshot assigns each listed element a short ref ("e1", "e2", ...) so a
 * follow-up page.click/page.type can target it directly instead of writing a
 * selector. Refs are only valid until the next snapshot — resolveRef clears
 * and rebuilds the whole map on every call, matching how a real DOM ref would
 * go stale after the page changes.
 */

let refs = new Map<string, Element>();
let counter = 0;

/** Start a fresh ref map — call once per page.snapshot, before assignRef(). */
export function resetRefs(): void {
    refs = new Map();
    counter = 0;
}

export function assignRef(el: Element): string {
    counter += 1;
    const ref = `e${counter}`;
    refs.set(ref, el);
    return ref;
}

export function resolveRef(ref: string): Element | undefined {
    return refs.get(ref);
}
