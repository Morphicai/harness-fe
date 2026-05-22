import { describe, expect, it, vi } from 'vitest';
import { openBrowser } from './openBrowser.js';

/**
 * Unit tests for the cross-platform browser launcher. We mock both
 * `spawn` and the platform/env probes so the test runs deterministically
 * on any host — no actual browser windows pop open in CI.
 */
describe('openBrowser', () => {
    function spy() {
        return vi.fn(() => ({
            unref: vi.fn(),
        }) as any);
    }

    it('uses `open` on darwin', () => {
        const spawnFn = spy();
        const out = openBrowser('https://example.test', {
            platformOverride: 'darwin',
            envOverride: {},
            spawnOverride: spawnFn,
        });
        expect(out.opened).toBe(true);
        expect(spawnFn).toHaveBeenCalledWith('open', ['https://example.test'], expect.any(Object));
    });

    it('uses `xdg-open` on linux', () => {
        const spawnFn = spy();
        const out = openBrowser('https://example.test', {
            platformOverride: 'linux',
            envOverride: {},
            spawnOverride: spawnFn,
        });
        expect(out.opened).toBe(true);
        expect(spawnFn).toHaveBeenCalledWith('xdg-open', ['https://example.test'], expect.any(Object));
    });

    it('uses `cmd /c start "" <url>` on win32 (empty title is required)', () => {
        const spawnFn = spy();
        const out = openBrowser('https://example.test', {
            platformOverride: 'win32',
            envOverride: {},
            spawnOverride: spawnFn,
        });
        expect(out.opened).toBe(true);
        expect(spawnFn).toHaveBeenCalledWith(
            'cmd',
            ['/c', 'start', '', 'https://example.test'],
            expect.any(Object),
        );
    });

    it('short-circuits when HARNESS_FE_HEADLESS=1 is set', () => {
        const spawnFn = spy();
        const out = openBrowser('https://example.test', {
            platformOverride: 'darwin',
            envOverride: { HARNESS_FE_HEADLESS: '1' },
            spawnOverride: spawnFn,
        });
        expect(out.opened).toBe(false);
        expect(out.reason).toMatch(/HEADLESS/);
        expect(spawnFn).not.toHaveBeenCalled();
    });

    it('returns opened=false on unsupported platforms with a reason', () => {
        const spawnFn = spy();
        const out = openBrowser('https://example.test', {
            platformOverride: 'freebsd' as NodeJS.Platform,
            envOverride: {},
            spawnOverride: spawnFn,
        });
        expect(out.opened).toBe(false);
        expect(out.reason).toMatch(/unsupported platform/);
        expect(spawnFn).not.toHaveBeenCalled();
    });

    it('catches spawn errors and returns opened=false', () => {
        const spawnFn = vi.fn(() => {
            throw new Error('ENOENT: no such file');
        }) as unknown as typeof openBrowser['arguments'][1]['spawnOverride'];
        const out = openBrowser('https://example.test', {
            platformOverride: 'darwin',
            envOverride: {},
            spawnOverride: spawnFn as any,
        });
        expect(out.opened).toBe(false);
        expect(out.reason).toMatch(/ENOENT/);
    });

    it('detaches and unrefs the child so it survives the parent exit', () => {
        const unref = vi.fn();
        const spawnFn = vi.fn(() => ({ unref })) as any;
        openBrowser('https://example.test', {
            platformOverride: 'darwin',
            envOverride: {},
            spawnOverride: spawnFn,
        });
        const opts = (spawnFn.mock.calls[0]?.[2] ?? {}) as { detached?: boolean; stdio?: string };
        expect(opts.detached).toBe(true);
        expect(opts.stdio).toBe('ignore');
        expect(unref).toHaveBeenCalledOnce();
    });
});
