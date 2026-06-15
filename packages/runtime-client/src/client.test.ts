// @vitest-environment happy-dom
import { describe, expect, it, afterEach, vi } from 'vitest';

// rrweb has CJS/ESM interop issues under happy-dom; stub it out so client.ts
// can be imported without crashing in the test environment.
vi.mock('rrweb', () => ({ record: () => () => {}, EventType: { Custom: 5 } }));
vi.mock('./commands.js', () => ({
    commandHandlers: {},
}));

import { tryInheritFromParent } from './parent-inherit.js';
import { readInjectedConfig } from './client.js';

/**
 * tryInheritFromParent has three branches:
 *   1. `window.parent === window` → top-level page, return {}
 *   2. same-origin parent with harness-fe runtime → read tabId/sessionId/projectId
 *   3. cross-origin parent → SecurityError when accessing parent props → catch → {}
 *
 * happy-dom doesn't enforce cross-origin security boundaries, so branch 3 is
 * simulated by replacing `window.parent` with a Proxy that throws.
 */
describe('tryInheritFromParent', () => {
    const origParentDescriptor = Object.getOwnPropertyDescriptor(window, 'parent');

    afterEach(() => {
        if (origParentDescriptor) {
            Object.defineProperty(window, 'parent', origParentDescriptor);
        }
        delete (window as any).__hfe_session_id__;
        delete (window as any).__harness_fe_client__;
        delete (window as any).__HARNESS_FE__;
        try {
            sessionStorage.removeItem('__hfe_tab_id__');
        } catch {
            /* noop */
        }
    });

    it('returns empty object when running at top level (parent === window)', () => {
        // happy-dom default: window.parent === window
        expect(window.parent).toBe(window);
        expect(tryInheritFromParent()).toEqual({});
    });

    it('reads parent tabId / sessionId / projectId when same-origin parent has harness-fe', () => {
        const fakeParent = {
            __hfe_session_id__: 'parent-session-xyz',
            __harness_fe_client__: {
                tabId: 'parent-tab-abc',
                sessionId: 'parent-session-xyz',
            },
            __HARNESS_FE__: { projectId: 'iframe-parent' },
            // sessionStorage isn't read because __harness_fe_client__.tabId
            // already returns a value. Keeping it minimal here.
            sessionStorage: undefined as unknown as Storage,
        };
        Object.defineProperty(window, 'parent', { value: fakeParent, configurable: true });

        expect(tryInheritFromParent()).toEqual({
            tabId: 'parent-tab-abc',
            sessionId: 'parent-session-xyz',
            parentProjectId: 'iframe-parent',
        });
    });

    it('falls back to parent.sessionStorage for tabId when no client global is exposed yet', () => {
        // Simulates: parent runtime hasn't finished booting; sessionStorage
        // is already populated from a previous tab session.
        const fakeStorage = {
            getItem: (key: string) => (key === '__hfe_tab_id__' ? 'storage-tab' : null),
        } as unknown as Storage;
        const fakeParent = {
            __HARNESS_FE__: { projectId: 'iframe-parent' },
            sessionStorage: fakeStorage,
        };
        Object.defineProperty(window, 'parent', { value: fakeParent, configurable: true });

        const out = tryInheritFromParent();
        expect(out.tabId).toBe('storage-tab');
        expect(out.parentProjectId).toBe('iframe-parent');
        expect(out.sessionId).toBeUndefined(); // parent hasn't booted yet
    });

    it('returns empty object on cross-origin SecurityError', () => {
        // Cross-origin: any property read on window.parent throws.
        const evilParent = new Proxy(
            {},
            {
                get(): never {
                    throw new DOMException('Blocked a frame...', 'SecurityError');
                },
            },
        );
        Object.defineProperty(window, 'parent', { value: evilParent, configurable: true });
        expect(tryInheritFromParent()).toEqual({});
    });
});

describe('overlay config', () => {
    afterEach(() => {
        delete (window as any).__HARNESS_FE__;
    });

    it('overlay:false is read from window.__HARNESS_FE__', () => {
        (window as any).__HARNESS_FE__ = { projectId: 'x', mcpUrl: 'ws://localhost:9000/ws', overlay: false };
        const config = readInjectedConfig();
        expect(config.overlay).toBe(false);
    });

    it('overlay defaults to true when not set', () => {
        (window as any).__HARNESS_FE__ = { projectId: 'x', mcpUrl: 'ws://localhost:9000/ws' };
        const config = readInjectedConfig();
        expect(config.overlay).toBe(true);
    });
});

describe('consent config from window.__HARNESS_FE__', () => {
    afterEach(() => {
        delete (window as any).__HARNESS_FE__;
    });

    it('reads consent field', () => {
        (window as any).__HARNESS_FE__ = { projectId: 'x', mcpUrl: 'ws://localhost:9000/ws', consent: 'always' };
        const config = readInjectedConfig();
        expect(config.consent).toBe('always');
    });
});

describe('runtime/perf knobs from window.__HARNESS_FE__ (harness-fe#162)', () => {
    afterEach(() => {
        delete (window as any).__HARNESS_FE__;
    });

    it('reads rrwebCheckoutEveryNms / deferStart / rrwebBlockSelector / idbThrottleMs', () => {
        (window as any).__HARNESS_FE__ = {
            projectId: 'x',
            mcpUrl: 'ws://localhost:9000/ws',
            rrwebCheckoutEveryNms: 60_000,
            deferStart: true,
            rrwebBlockSelector: 'wujie-app',
            idbThrottleMs: 250,
        };
        const config = readInjectedConfig();
        expect(config.rrwebCheckoutEveryNms).toBe(60_000);
        expect(config.deferStart).toBe(true);
        expect(config.rrwebBlockSelector).toBe('wujie-app');
        expect(config.idbThrottleMs).toBe(250);
    });

    it('leaves the knobs undefined when not injected', () => {
        (window as any).__HARNESS_FE__ = { projectId: 'x', mcpUrl: 'ws://localhost:9000/ws' };
        const config = readInjectedConfig();
        expect(config.rrwebCheckoutEveryNms).toBeUndefined();
        expect(config.deferStart).toBeUndefined();
        expect(config.rrwebBlockSelector).toBeUndefined();
        expect(config.idbThrottleMs).toBeUndefined();
    });
});
