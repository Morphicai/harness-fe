/**
 * The whole reason this package exists: loader options MUST be JSON-
 * serializable, otherwise thread-loader crashes when dispatching jobs to
 * its worker pool (`WorkerPool.writeJson` → JSON.stringify → circular
 * structure on `Compiler.root`).
 *
 * This test pins that invariant.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { harnessaFE, HarnessaFEWebpackPlugin } from './plugin.js';

describe('HarnessaFEWebpackPlugin', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        // EntryPlugin tries to tap an unstubbed hook in our minimal mock and
        // hits our catch-and-warn path. That's fine functionally but noisy.
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        warnSpy.mockRestore();
    });

    function buildMockCompiler() {
        const rules: any[] = [];
        const hookCalls: Record<string, number> = {};
        const tapStub = (_name: string) => {
            hookCalls[_name] = (hookCalls[_name] ?? 0) + 1;
        };
        const compiler = {
            options: {
                context: '/fake/project/root',
                mode: 'development',
                module: { rules },
            },
            context: '/fake/project/root',
            hooks: {
                afterEnvironment: { tap: tapStub.bind(null, 'afterEnvironment') },
                shutdown: { tap: tapStub.bind(null, 'shutdown') },
                compilation: { tap: tapStub.bind(null, 'compilation') },
                done: { tap: tapStub.bind(null, 'done') },
            },
        };
        return { compiler, rules, hookCalls };
    }

    it('registers a pre-rule whose loader options are JSON-serializable', () => {
        const { compiler, rules } = buildMockCompiler();
        // Force disabled=true to keep the test focused on rule injection
        // (we don't want to actually open a websocket or inject runtime here).
        const plugin = new HarnessaFEWebpackPlugin({ projectId: 'test' });

        // disabled bails out before rule injection — call apply with enabled
        // but avoid the side-effecty hooks by stubbing webpack module loading.
        // Easiest: enable, accept that hooks tap (they're stubbed above).
        plugin.apply(compiler);

        expect(rules.length).toBe(1);
        const rule = rules[0];
        expect(rule.enforce).toBe('pre');
        expect(rule.test).toBeInstanceOf(RegExp);
        expect(rule.use).toHaveLength(1);

        const use = rule.use[0];
        expect(use.loader).toMatch(/loader\.js$/);

        // The critical assertion: options must round-trip through JSON
        // without throwing on circular structure.
        expect(() => JSON.stringify(use.options)).not.toThrow();

        const parsed = JSON.parse(JSON.stringify(use.options));
        expect(parsed.pluginId).toBeDefined();
        expect(parsed.projectRoot).toBe('/fake/project/root');
        expect(parsed.vueOptions).toEqual({ safeMode: true, dryRun: false });
        expect(parsed.disabled).toBe(false);
    });

    it('matches the right file extensions including vue-loader virtual sub-modules', () => {
        const { compiler, rules } = buildMockCompiler();
        new HarnessaFEWebpackPlugin().apply(compiler);
        const re: RegExp = rules[0].test;

        expect(re.test('/a/App.vue')).toBe(true);
        expect(re.test('/a/App.vue?vue&type=template')).toBe(true);
        expect(re.test('/a/App.vue?vue&type=script&lang=ts')).toBe(true);
        expect(re.test('/a/Foo.tsx')).toBe(true);
        expect(re.test('/a/Foo.jsx')).toBe(true);
        expect(re.test('/a/Foo.ts')).toBe(false);
        expect(re.test('/a/Foo.js')).toBe(false);
        expect(re.test('/a/styles.css')).toBe(false);
    });

    it('skips rule injection when disabled', () => {
        const { compiler, rules } = buildMockCompiler();
        new HarnessaFEWebpackPlugin({ disabled: true }).apply(compiler);
        expect(rules).toHaveLength(0);
    });

    it('factory and class produce equivalent shapes', () => {
        const { compiler: c1, rules: r1 } = buildMockCompiler();
        const { compiler: c2, rules: r2 } = buildMockCompiler();
        harnessaFE({ projectId: 'a' }).apply(c1);
        new HarnessaFEWebpackPlugin({ projectId: 'a' }).apply(c2);
        expect(r1[0].test.source).toBe(r2[0].test.source);
        expect(r1[0].enforce).toBe(r2[0].enforce);
    });
});
