import { describe, expect, it } from 'vitest';
import { unpluginFactory } from './core.js';
import type { HarnessFEOptions } from './internal/types.js';

const HTML = '<!doctype html><html><head><title>t</title></head><body></body></html>';

/** The factory's return type is the loose unplugin shape; narrow to what we assert on. */
function createPlugin(options?: HarnessFEOptions) {
    return unpluginFactory(options) as {
        transformInclude(id: string): boolean;
        vite: { transformIndexHtml: { handler(html: string): string } };
    };
}

describe('transformIndexHtml — inject option', () => {
    it('injects the config + runtime script by default', () => {
        const out = createPlugin({ projectId: 'demo' }).vite.transformIndexHtml.handler(HTML);
        expect(out).toContain('window.__HARNESS_FE__');
        expect(out).toContain('virtual:harness-fe/runtime');
    });

    it('returns the original html when inject:false, keeping source tagging on', () => {
        const plugin = createPlugin({ projectId: 'demo', inject: false });
        expect(plugin.vite.transformIndexHtml.handler(HTML)).toBe(HTML);
        // The JSX/Vue tagging transform is unaffected by inject:false.
        expect(plugin.transformInclude('/src/App.tsx')).toBe(true);
    });

    it('returns the original html when disabled (unchanged behaviour)', () => {
        expect(createPlugin({ disabled: true }).vite.transformIndexHtml.handler(HTML)).toBe(HTML);
    });
});
