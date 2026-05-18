<script setup>
import { ref } from 'vue';
import Counter from './Counter.vue';

defineOptions({ name: 'App' });

const message = ref('Harnessa-FE · Webpack 5 + Vue 3 demo');
</script>

<template>
    <main class="container">
        <h1>{{ message }}</h1>
        <p class="hint">
            Inspect any element to see <code>data-morphix-loc</code> and
            <code>data-morphix-comp</code> attributes injected at build time.
        </p>
        <Counter :start="0" />
        <Counter :start="10" />
    </main>
</template>

<style scoped>
.container {
    font-family: ui-sans-serif, system-ui, sans-serif;
    max-width: 640px;
    margin: 3rem auto;
    padding: 0 1.5rem;
    line-height: 1.5;
}
.hint {
    color: #666;
    font-size: 0.95rem;
}
code {
    background: #f4f4f5;
    padding: 0 4px;
    border-radius: 3px;
    font-size: 0.9em;
}
</style>
