import { describe, it, expect } from 'vitest';
import { transformVueSFC, type VueTransformResult } from './vue-transform.js';
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
