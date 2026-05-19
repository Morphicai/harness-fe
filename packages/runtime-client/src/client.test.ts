// @vitest-environment happy-dom
import { describe, expect, it, afterEach } from 'vitest';
import { tryInheritFromParent } from './parent-inherit.js';

/**
 * tryInheritFromParent has three branches:
 *   1. `window.parent === window` → top-level page, return {}
 *   2. same-origin parent with harnessa-fe runtime → read tabId/sessionId/projectId
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
        delete (window as any).__harnessa_fe_client__;
        delete (window as any).__HARNESSA_FE__;
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

    it('reads parent tabId / sessionId / projectId when same-origin parent has harnessa-fe', () => {
        const fakeParent = {
            __hfe_session_id__: 'parent-session-xyz',
            __harnessa_fe_client__: {
                tabId: 'parent-tab-abc',
                sessionId: 'parent-session-xyz',
            },
            __HARNESSA_FE__: { projectId: 'iframe-parent' },
            // sessionStorage isn't read because __harnessa_fe_client__.tabId
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
            __HARNESSA_FE__: { projectId: 'iframe-parent' },
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
