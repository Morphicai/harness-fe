/**
 * Visitor identity + environment capture.
 *
 * `visitorId` is an opaque UUID persisted in `localStorage.__hfe_visitor_id__`
 * (per-origin, per-browser). It stitches a user's activity across pageloads,
 * refreshes, and tabs so the daemon can build a coherent user journey.
 *
 * Privacy: anonymous by default. No canvas / WebGL / AudioContext
 * fingerprinting. The app may pass `userId` via `HarnessaScript userId=…`
 * which the daemon attaches to `VisitorMeta.userId` — that field is only
 * meaningful when the host app explicitly opts in.
 */

import type { VisitorEnv } from '@harnessa-fe/protocol';

const VISITOR_ID_KEY = '__hfe_visitor_id__';

/** Read or lazily create the visitorId. localStorage scope = per-origin. */
export function getOrCreateVisitorId(): string {
    try {
        const existing = localStorage.getItem(VISITOR_ID_KEY);
        if (existing && existing.length > 0) return existing;
        const id = generateVisitorId();
        localStorage.setItem(VISITOR_ID_KEY, id);
        return id;
    } catch {
        // localStorage can throw on iOS Safari private mode / disabled storage.
        // Fall back to an in-memory ephemeral id so events still flow.
        return generateVisitorId();
    }
}

function generateVisitorId(): string {
    try {
        return `v_${crypto.randomUUID()}`;
    } catch {
        return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
    }
}

/**
 * Same-origin iframe child inherits the parent's visitorId so the journey
 * stitches across micro-frontends. Cross-origin children fall back to their
 * own (a different visitorId — expected, browsers isolate localStorage).
 */
export function tryInheritVisitorFromParent(): string | undefined {
    if (typeof window === 'undefined' || window.parent === window) return undefined;
    try {
        const p = window.parent as Window & {
            localStorage?: Storage;
            __harnessa_fe_visitor_id__?: string;
        };
        // Prefer the runtime-exposed global; fall back to parent's localStorage
        // when the parent's runtime hasn't yet exposed the cache (race).
        if (p.__harnessa_fe_visitor_id__) return p.__harnessa_fe_visitor_id__;
        const fromLs = p.localStorage?.getItem(VISITOR_ID_KEY);
        return fromLs ?? undefined;
    } catch {
        // SecurityError when cross-origin — expected, swallow.
        return undefined;
    }
}

/**
 * Snapshot the browser environment for this pageload. Cheap (all sync
 * reads); safe to call on every hello.
 */
export function collectEnv(): VisitorEnv {
    const screenObj = (typeof screen !== 'undefined' ? screen : undefined) as Screen | undefined;
    const dprNow = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const colorScheme: 'light' | 'dark' | 'unknown' =
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-color-scheme: dark)').matches
                ? 'dark'
                : 'light'
            : 'unknown';
    const reducedMotion =
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
            : false;
    return {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        language: typeof navigator !== 'undefined' ? navigator.language : 'en',
        languages:
            typeof navigator !== 'undefined' && navigator.languages
                ? Array.from(navigator.languages)
                : [],
        timezone:
            typeof Intl !== 'undefined' && Intl.DateTimeFormat
                ? (Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC')
                : 'UTC',
        timezoneOffsetMin: new Date().getTimezoneOffset(),
        screen: {
            width: screenObj?.width ?? 0,
            height: screenObj?.height ?? 0,
            dpr: dprNow,
            colorDepth: screenObj?.colorDepth,
        },
        viewport: {
            width: typeof window !== 'undefined' ? window.innerWidth : 0,
            height: typeof window !== 'undefined' ? window.innerHeight : 0,
        },
        colorScheme,
        reducedMotion,
        platform:
            typeof navigator !== 'undefined' && 'platform' in navigator
                ? (navigator as Navigator & { platform: string }).platform
                : undefined,
    };
}

/** Expose to same-origin iframes; called by client.ts after resolving id. */
export function publishVisitorIdToWindow(id: string): void {
    if (typeof window === 'undefined') return;
    (window as Window & { __harnessa_fe_visitor_id__?: string }).__harnessa_fe_visitor_id__ = id;
}
