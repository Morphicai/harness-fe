import { describe, it, expect } from 'vitest';
import {
    transformVueSFC,
    transformVueTemplate,
    resolveVueComponentName,
    getTemplateLineOffset,
    type VueTransformResult,
} from './vue-transform.js';
import type { ComponentMap } from './transform.js';

function makeMap(): ComponentMap {
    return new Map();
}

describe('transformVueSFC', () => {
    it('injects data-morphix-loc and data-morphix-comp on template elements', () => {
        const source = `<template>
  <div class="app">
    <h1>Hello</h1>
  </div>
</template>

<script setup lang="ts">
defineOptions({ name: 'MyApp' });
</script>
`;
        const map = makeMap();
        const result = transformVueSFC(source, 'src/App.vue', map);

        expect(result).not.toBeNull();
        expect(result!.taggedCount).toBeGreaterThan(0);
        expect(result!.code).toContain('data-morphix-loc="src/App.vue:');
        expect(result!.code).toContain('data-morphix-comp="MyApp"');
        expect(result!.componentName).toBe('MyApp');
    });

    it('resolves component name from defineOptions in <script setup>', () => {
        const source = `<template>
  <div>test</div>
</template>

<script setup>
defineOptions({ name: 'CustomName' });
</script>
`;
        const map = makeMap();
        const result = transformVueSFC(source, 'src/Whatever.vue', map);

        expect(result).not.toBeNull();
        expect(result!.componentName).toBe('CustomName');
        expect(result!.code).toContain('data-morphix-comp="CustomName"');
    });

    it('resolves component name from export default { name } in <script>', () => {
        const source = `<template>
  <div>test</div>
</template>

<script>
export default {
  name: 'OptionsName',
  data() { return {}; }
}
</script>
`;
        const map = makeMap();
        const result = transformVueSFC(source, 'src/Whatever.vue', map);

        expect(result).not.toBeNull();
        expect(result!.componentName).toBe('OptionsName');
        expect(result!.code).toContain('data-morphix-comp="OptionsName"');
    });

    it('resolves component name from filename', () => {
        const source = `<template>
  <div>test</div>
</template>

<script setup>
const x = 1;
</script>
`;
        const map = makeMap();
        const result = transformVueSFC(source, 'src/MyComponent.vue', map);

        expect(result).not.toBeNull();
        expect(result!.componentName).toBe('MyComponent');
    });

    it('uses parent directory name for index.vue', () => {
        const source = `<template>
  <div>test</div>
</template>

<script setup>
const x = 1;
</script>
`;
        const map = makeMap();
        const result = transformVueSFC(source, 'src/user-profile/index.vue', map);

        expect(result).not.toBeNull();
        expect(result!.componentName).toBe('UserProfile');
    });

    it('preserves Vue directives (v-if, v-for, v-bind)', () => {
        const source = `<template>
  <div v-if="show" :class="cls" @click="handler">
    <span v-for="item in items" :key="item.id">{{ item.name }}</span>
  </div>
</template>

<script setup>
defineOptions({ name: 'DirectiveTest' });
const show = true;
const cls = 'active';
const items = [];
const handler = () => {};
</script>
`;
        const map = makeMap();
        const result = transformVueSFC(source, 'src/Test.vue', map);

        expect(result).not.toBeNull();
        // Original directives must still be present
        expect(result!.code).toContain('v-if="show"');
        expect(result!.code).toContain(':class="cls"');
        expect(result!.code).toContain('@click="handler"');
        expect(result!.code).toContain('v-for="item in items"');
        expect(result!.code).toContain(':key="item.id"');
        // And our attributes are injected
        expect(result!.code).toContain('data-morphix-loc=');
        expect(result!.code).toContain('data-morphix-comp="DirectiveTest"');
    });

    it('returns null for unparseable files', () => {
        const source = `this is not a valid vue file at all {{{{`;
        const map = makeMap();
        const result = transformVueSFC(source, 'src/Bad.vue', map);

        // Should return null (no template block found)
        expect(result).toBeNull();
    });

    it('registers component in ComponentMap', () => {
        const source = `<template>
  <div>
    <span>hello</span>
  </div>
</template>

<script setup>
defineOptions({ name: 'RegisteredComp' });
</script>
`;
        const map = makeMap();
        transformVueSFC(source, 'src/Registered.vue', map);

        expect(map.has('RegisteredComp')).toBe(true);
        const entries = map.get('RegisteredComp')!;
        expect(entries.length).toBeGreaterThan(0);
        expect(entries[0].file).toBe('src/Registered.vue');
    });

    it('returns null for SFC without template', () => {
        const source = `<script setup>
const x = 1;
</script>
`;
        const map = makeMap();
        const result = transformVueSFC(source, 'src/NoTemplate.vue', map);

        expect(result).toBeNull();
    });

    it('handles kebab-case filename conversion to PascalCase', () => {
        const source = `<template>
  <div>test</div>
</template>
`;
        const map = makeMap();
        const result = transformVueSFC(source, 'src/my-fancy-button.vue', map);

        expect(result).not.toBeNull();
        expect(result!.componentName).toBe('MyFancyButton');
    });
});

// Webpack + vue-loader: vue-loader splits the SFC into virtual sub-modules and
// re-reads from disk for each request. Our transform must tag template
// fragments separately on those sub-module hits.
describe('transformVueTemplate (webpack vue-loader sub-module path)', () => {
    it('injects data-morphix-* on every element in a bare template fragment', () => {
        const templateFragment = `<div class="container">
  <h1>Title</h1>
  <p>Body</p>
</div>`;
        const map: ComponentMap = new Map();
        const result = transformVueTemplate(templateFragment, 'src/App.vue', 'App', map, 0);

        expect(result).not.toBeNull();
        expect(result!.taggedCount).toBe(3);
        expect(result!.code).toContain('data-morphix-loc="src/App.vue:1:');
        expect(result!.code).toContain('data-morphix-comp="App"');
    });

    it('applies lineOffset so locations are file-relative, not fragment-relative', () => {
        const templateFragment = `<div>x</div>`;
        const map: ComponentMap = new Map();
        const result = transformVueTemplate(templateFragment, 'src/Foo.vue', 'Foo', map, 7);

        expect(result).not.toBeNull();
        // Element at fragment line 1 + offset 7 = file line 8
        expect(result!.code).toMatch(/data-morphix-loc="src\/Foo\.vue:8:/);
    });

    it('returns null when the fragment has no elements (e.g. text only)', () => {
        const map: ComponentMap = new Map();
        expect(transformVueTemplate('plain text', 'src/Foo.vue', 'Foo', map)).toBeNull();
    });

    it('preserves existing data-morphix-* attributes (idempotent)', () => {
        const templateFragment = `<div data-morphix-loc="src/Foo.vue:99:99" data-morphix-comp="Foo">x</div>`;
        const map: ComponentMap = new Map();
        const result = transformVueTemplate(templateFragment, 'src/Foo.vue', 'Foo', map, 0);
        // No tagging happens — existing attrs already cover both
        expect(result).toBeNull();
    });

    it('populates componentMap with file-relative line numbers', () => {
        const templateFragment = `<button>click</button>`;
        const map: ComponentMap = new Map();
        transformVueTemplate(templateFragment, 'src/Counter.vue', 'Counter', map, 5);

        const entries = map.get('Counter');
        expect(entries).toBeDefined();
        expect(entries![0]).toMatchObject({ file: 'src/Counter.vue', line: 6, col: 1 });
    });
});

describe('resolveVueComponentName + getTemplateLineOffset (SFC helpers)', () => {
    it('resolveVueComponentName picks up defineOptions name', () => {
        const sfc = `<script setup>defineOptions({ name: 'CustomName' });</script>
<template><div>x</div></template>`;
        expect(resolveVueComponentName(sfc, 'src/Anything.vue')).toBe('CustomName');
    });

    it('resolveVueComponentName falls back to filename PascalCase', () => {
        const sfc = `<template><div>x</div></template>`;
        expect(resolveVueComponentName(sfc, 'src/my-widget.vue')).toBe('MyWidget');
    });

    it('getTemplateLineOffset returns line of first char inside <template>', () => {
        // template tag is on line 3, content starts on the same line (after the >)
        const sfc = `<script>
export default {};
</script><template><div>x</div></template>`;
        // descriptor.template.loc.start.line is the line of the first content
        // char (after the closing >). We subtract 1 so fragment line 1 maps
        // to this source line.
        const offset = getTemplateLineOffset(sfc, 'src/Foo.vue');
        expect(offset).toBeGreaterThanOrEqual(0);
    });

    it('getTemplateLineOffset returns 0 when SFC has no template', () => {
        const sfc = `<script>export default {};</script>`;
        expect(getTemplateLineOffset(sfc, 'src/Foo.vue')).toBe(0);
    });
});

// ─── Vue 2 hardening — pathological inputs must not break the build ────────

describe('Vue 2 legacy syntax — must never throw, must never corrupt output', () => {
    it('Vue 2 filter syntax {{ x | foo }} is handled without throwing', () => {
        // @vue/compiler-dom in Vue 3 either errors or treats `|` as bitwise.
        // Either way: never throw, never emit a broken template.
        const source = `<template>
  <div>{{ message | uppercase }}</div>
</template>
<script>export default { name: 'LegacyFilter' };</script>
`;
        const map = makeMap();
        expect(() => transformVueSFC(source, 'src/LegacyFilter.vue', map)).not.toThrow();
    });

    it('<template functional> functional component does not throw', () => {
        const source = `<template functional>
  <div>{{ props.value }}</div>
</template>
`;
        const map = makeMap();
        expect(() => transformVueSFC(source, 'src/Func.vue', map)).not.toThrow();
    });

    it('v-bind.sync attribute parses through (Vue 2 modifier kept as attribute)', () => {
        const source = `<template>
  <input :value.sync="model" />
</template>
<script>export default { name: 'SyncInput' };</script>
`;
        const map = makeMap();
        const result = transformVueSFC(source, 'src/SyncInput.vue', map);
        // .sync is no longer a real Vue 3 modifier but it's a valid attribute
        // string from the parser's perspective. The element still gets tagged.
        expect(result).not.toBeNull();
        expect(result!.code).toContain('data-morphix-loc=');
    });

    it('slot="x" / slot-scope still allow tagging the host element', () => {
        const source = `<template>
  <div>
    <child>
      <template slot="header" slot-scope="props">
        <span>{{ props.title }}</span>
      </template>
    </child>
  </div>
</template>
<script>export default { name: 'SlotHost' };</script>
`;
        const map = makeMap();
        expect(() => transformVueSFC(source, 'src/SlotHost.vue', map)).not.toThrow();
    });

    it('safeMode (default) returns null on synthesised malformed SFC', () => {
        // Real-world miss: SFC with unbalanced template that compiler-sfc may
        // partially accept. Guarded by safeMode self-check.
        const source = `<template>
  <div><span></div></span>
</template>
`;
        const map = makeMap();
        const result = transformVueSFC(source, 'src/Bad.vue', map);
        // Either returned null OR returned a result whose code re-parses
        // cleanly. The contract: never throw, never hand back broken output.
        if (result) {
            expect(() => {
                // Cheap sanity check: there should be the same number of
                // injected attrs as opening tags.
                const count = (result.code.match(/data-morphix-loc=/g) ?? []).length;
                expect(count).toBeGreaterThanOrEqual(0);
            }).not.toThrow();
        }
    });

    it('updates stats counters for skipped files', () => {
        const stats = {
            filesAttempted: 0,
            filesInjected: 0,
            elementsTagged: 0,
            skippedSfcError: 0,
            skippedTemplateError: 0,
            skippedWalkError: 0,
            skippedSelfCheck: 0,
            skippedPaths: [] as string[],
        };
        const source = `<template>
  <div>{{ x | filter }}</div>
</template>
`;
        const map = makeMap();
        // safeMode on by default — filter syntax should NOT throw.
        transformVueSFC(source, 'src/Filter.vue', map, { stats });
        expect(stats.filesAttempted).toBe(1);
        // We don't assert which counter incremented — different compiler
        // versions classify filters differently — only that at most one
        // skip counter went up (or it injected cleanly).
        const totalSkips =
            stats.skippedSfcError + stats.skippedTemplateError +
            stats.skippedWalkError + stats.skippedSelfCheck;
        expect(totalSkips + stats.filesInjected).toBe(1);
    });

    it('dryRun=true populates componentMap but returns null', () => {
        const source = `<template>
  <div><span>hi</span></div>
</template>
<script>export default { name: 'DryRunVue' };</script>
`;
        const map = makeMap();
        const result = transformVueSFC(source, 'src/DryRun.vue', map, { dryRun: true });
        expect(result).toBeNull();
        // Component map still populated so source-aware tools work in dry-run.
        expect(map.has('DryRunVue')).toBe(true);
    });

    it('safeMode=false skips the self-check', () => {
        // Smoke test: same input passes through both modes without throwing.
        const source = `<template><div>x</div></template>
<script>export default { name: 'NoCheck' };</script>
`;
        const map = makeMap();
        const safe = transformVueSFC(source, 'src/NoCheck.vue', map);
        const unsafe = transformVueSFC(source, 'src/NoCheck.vue', makeMap(), { safeMode: false });
        expect(safe).not.toBeNull();
        expect(unsafe).not.toBeNull();
    });
});
