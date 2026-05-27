import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    registerOverlayPlugin,
    getOverlayPlugins,
    subscribeOverlayPlugins,
    drainPluginQueue,
    __resetOverlayPlugins,
    type OverlayPlugin,
} from './pluginRegistry.js';

const noop = () => {};

function plugin(id: string, over: Partial<OverlayPlugin> = {}): OverlayPlugin {
    return { id, label: id, onClick: noop, ...over };
}

afterEach(() => __resetOverlayPlugins());

describe('pluginRegistry', () => {
    it('registers and lists in order', () => {
        registerOverlayPlugin(plugin('a'));
        registerOverlayPlugin(plugin('b'));
        expect(getOverlayPlugins().map((p) => p.id)).toEqual(['a', 'b']);
    });

    it('re-registering an id replaces, keeps position', () => {
        registerOverlayPlugin(plugin('a', { label: 'first' }));
        registerOverlayPlugin(plugin('b'));
        registerOverlayPlugin(plugin('a', { label: 'second' }));
        const ids = getOverlayPlugins().map((p) => p.id);
        expect(ids).toEqual(['a', 'b']);
        expect(getOverlayPlugins().find((p) => p.id === 'a')!.label).toBe('second');
    });

    it('unregister removes the plugin', () => {
        const off = registerOverlayPlugin(plugin('a'));
        expect(getOverlayPlugins()).toHaveLength(1);
        off();
        expect(getOverlayPlugins()).toHaveLength(0);
    });

    it('unregister is a no-op once the id was replaced', () => {
        const off = registerOverlayPlugin(plugin('a', { label: 'old' }));
        registerOverlayPlugin(plugin('a', { label: 'new' })); // replaces
        off(); // should NOT remove the new one
        expect(getOverlayPlugins().map((p) => p.id)).toEqual(['a']);
        expect(getOverlayPlugins()[0].label).toBe('new');
    });

    it('rejects a plugin with no id or no onClick', () => {
        expect(() => registerOverlayPlugin({ label: 'x' } as unknown as OverlayPlugin)).toThrow();
        expect(() =>
            registerOverlayPlugin({ id: 'x', label: 'x' } as unknown as OverlayPlugin),
        ).toThrow();
    });

    it('notifies subscribers on add / replace / remove (late registration)', () => {
        const fn = vi.fn();
        const unsub = subscribeOverlayPlugins(fn);
        const off = registerOverlayPlugin(plugin('a'));
        expect(fn).toHaveBeenCalledTimes(1);
        off();
        expect(fn).toHaveBeenCalledTimes(2);
        unsub();
        registerOverlayPlugin(plugin('b'));
        expect(fn).toHaveBeenCalledTimes(2); // no longer listening
    });

    it('drainPluginQueue registers an array and ignores junk', () => {
        drainPluginQueue([plugin('a'), plugin('b'), null, 42, { id: '', label: 'bad' }]);
        expect(getOverlayPlugins().map((p) => p.id)).toEqual(['a', 'b']);
        drainPluginQueue(undefined); // no throw
        drainPluginQueue('nope' as unknown);
        expect(getOverlayPlugins()).toHaveLength(2);
    });
});
