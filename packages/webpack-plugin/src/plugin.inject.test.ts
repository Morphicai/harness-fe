import { describe, expect, it } from 'vitest';
import { HarnessFEWebpackPlugin } from './plugin.js';

const HTML = '<!doctype html><html><head><title>t</title></head><body></body></html>';

/** injectConfigScript is private; reach it directly to assert the HTML rewrite. */
function inject(plugin: HarnessFEWebpackPlugin, html: string): string {
    return (plugin as unknown as { injectConfigScript(h: string): string }).injectConfigScript(html);
}

describe('webpack plugin — inject option', () => {
    it('injects the config script by default', () => {
        const out = inject(new HarnessFEWebpackPlugin({ projectId: 'demo' }), HTML);
        expect(out).toContain('window.__HARNESS_FE__');
    });

    it('returns the original html when inject:false', () => {
        expect(inject(new HarnessFEWebpackPlugin({ projectId: 'demo', inject: false }), HTML)).toBe(HTML);
    });
});
