import { describe, it, expect } from 'vitest';
import { getOrCreateComponentMap, clearComponentMap } from './shared-state.js';

describe('shared-state', () => {
    it('returns the same map for the same pluginId across calls', () => {
        const a = getOrCreateComponentMap('plugin-1');
        const b = getOrCreateComponentMap('plugin-1');
        expect(a).toBe(b);
        a.set('Foo', [{ file: 'x.tsx', line: 1, col: 0 }]);
        expect(b.get('Foo')?.length).toBe(1);
        clearComponentMap('plugin-1');
    });

    it('isolates maps between different plugin ids', () => {
        const a = getOrCreateComponentMap('plugin-A');
        const b = getOrCreateComponentMap('plugin-B');
        expect(a).not.toBe(b);
        a.set('Foo', [{ file: 'a.tsx', line: 1, col: 0 }]);
        expect(b.has('Foo')).toBe(false);
        clearComponentMap('plugin-A');
        clearComponentMap('plugin-B');
    });

    it('clearComponentMap forgets the entry', () => {
        const a = getOrCreateComponentMap('plugin-X');
        a.set('Foo', [{ file: 'x.tsx', line: 1, col: 0 }]);
        clearComponentMap('plugin-X');
        const b = getOrCreateComponentMap('plugin-X');
        expect(b.has('Foo')).toBe(false);
        clearComponentMap('plugin-X');
    });
});
