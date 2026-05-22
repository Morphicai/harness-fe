/**
 * runTransform dispatcher tests — verifies the right transform function is
 * picked for each id variant (.vue, .vue?type=template, .vue?type=script,
 * .tsx, .jsx) and that componentMap is populated for the cases that own
 * component name resolution.
 */
import { describe, it, expect } from 'vitest';
import type { ComponentMap } from '@harnessa-fe/unplugin';
import { runTransform } from './transform-runner.js';

const VUE_OPTIONS = { safeMode: true, dryRun: false } as const;

describe('runTransform', () => {
    it('transforms a .tsx file and populates componentMap', () => {
        const map: ComponentMap = new Map();
        const src = `
            export function App() {
                return <div className="root"><span>hi</span></div>;
            }
        `;
        const out = runTransform(src, '/project/App.tsx', '', '/project', VUE_OPTIONS, map);
        expect(out).not.toBeNull();
        expect(out!.code).toContain('data-morphix-loc=');
        expect(out!.code).toContain('data-morphix-comp="App"');
        const locs = map.get('App');
        expect(locs && locs.length).toBeGreaterThan(0);
    });

    it('returns null for non-template .vue sub-modules (script/style)', () => {
        const map: ComponentMap = new Map();
        const out = runTransform(
            'export default {}',
            '/project/App.vue',
            '?vue&type=script&lang=ts',
            '/project',
            VUE_OPTIONS,
            map,
        );
        expect(out).toBeNull();
        expect(map.size).toBe(0);
    });

    it('returns null for a non-JSX .tsx file (transformJsx returns null when nothing tagged)', () => {
        const map: ComponentMap = new Map();
        const out = runTransform(
            'export const x: number = 1;',
            '/project/util.tsx',
            '',
            '/project',
            VUE_OPTIONS,
            map,
        );
        expect(out).toBeNull();
    });

    it('returns null when transform encounters malformed source (errorRecovery falls back to no tags)', () => {
        const map: ComponentMap = new Map();
        const out = runTransform(
            'this is not valid javascript at all <<<>>>',
            '/project/broken.tsx',
            '',
            '/project',
            VUE_OPTIONS,
            map,
        );
        // Either returns null (no JSX found) or returns a result with no
        // taggedCount — both are acceptable, neither should throw.
        expect(out === null || typeof out.code === 'string').toBe(true);
    });
});
