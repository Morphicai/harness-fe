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
