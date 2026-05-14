<template>
    <main class="app">
        <h1>harnessa-fe · vue demo</h1>
        <p>Open Claude Code / Cursor and call MCP tools to drive this page.</p>

        <section class="counter">
            <h2>Counter</h2>
            <p>
                Current value: <strong data-morphix-comp="CounterValue">{{ count }}</strong>
            </p>
            <button
                type="button"
                aria-label="increment counter"
                data-morphix-comp="IncrementBtn"
                @click="increment"
            >
                Increment
            </button>
            <button
                type="button"
                aria-label="reset counter"
                data-morphix-comp="ResetBtn"
                @click="reset"
                style="margin-left: 8px"
            >
                Reset
            </button>
        </section>

        <section class="echo">
            <h2>Input echo</h2>
            <input
                data-morphix-comp="EchoInput"
                placeholder="type something"
                v-model="text"
                style="padding: 8px; width: 240px"
            />
            <p data-morphix-comp="EchoDisplay">Echo: {{ text || '(empty)' }}</p>
        </section>
    </main>
</template>

<script setup lang="ts">
import { ref } from 'vue';

defineOptions({ name: 'App' });

const count = ref(0);
const text = ref('');

function increment() {
    count.value++;
    console.log('[demo] incremented to', count.value);
}

function reset() {
    count.value = 0;
}
</script>

<style scoped>
.app {
    font-family: system-ui, sans-serif;
    padding: 32px;
    max-width: 640px;
    margin: 0 auto;
}

.counter,
.echo {
    margin-top: 24px;
}
</style>
