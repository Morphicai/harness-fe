import { describe, expect, it } from 'vitest';
import { allowsTool, filterManifest, requiredScope } from './scope.js';

describe('gateway scope mapping (5.0 · P6 · C4)', () => {
    it('mutating control commands require control', () => {
        expect(requiredScope('page.click')).toBe('control');
        expect(requiredScope('page.evaluate')).toBe('control');
        expect(requiredScope('page.navigate')).toBe('control');
    });

    it('reads (incl. screenshot/dom_query, not in CONTROL_COMMANDS) require read', () => {
        expect(requiredScope('console.tail')).toBe('read');
        expect(requiredScope('project.source')).toBe('read');
        expect(requiredScope('page.screenshot')).toBe('read');
    });

    it('allowsTool checks the caller holds the required scope', () => {
        expect(allowsTool(['read'], 'page.click')).toBe(false);
        expect(allowsTool(['read', 'control'], 'page.click')).toBe(true);
        expect(allowsTool(['read'], 'console.tail')).toBe(true);
        expect(allowsTool(['control'], 'console.tail')).toBe(false);
    });

    it('filterManifest drops out-of-scope tools', () => {
        const r = filterManifest(
            { tools: [{ name: 'page.click' }, { name: 'console.tail' }, { name: 'page.evaluate' }] },
            ['read'],
        );
        expect((r.tools as { name: string }[]).map((t) => t.name)).toEqual(['console.tail']);
    });

    it('filterManifest is tolerant of odd shapes', () => {
        expect(filterManifest({}, ['read'])).toEqual({});
        expect(filterManifest({ tools: 'nope' as unknown }, ['read'])).toEqual({ tools: 'nope' });
    });
});
