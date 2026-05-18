<script setup>
import { ref } from 'vue';

defineOptions({ name: 'Counter' });

const props = defineProps({
    start: { type: Number, default: 0 },
});

const count = ref(props.start);
const increment = () => count.value++;
const reset = () => (count.value = props.start);
</script>

<template>
    <div class="counter">
        <span class="label">Count:</span>
        <span class="value">{{ count }}</span>
        <button @click="increment" type="button">+1</button>
        <button @click="reset" type="button" class="reset">reset</button>
    </div>
</template>

<style scoped>
.counter {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 1rem 0;
}
.label {
    color: #666;
}
.value {
    font-weight: 600;
    min-width: 2ch;
    text-align: center;
}
button {
    border: 1px solid #d4d4d8;
    background: #fff;
    padding: 0.3rem 0.7rem;
    border-radius: 4px;
    cursor: pointer;
}
button:hover {
    background: #f4f4f5;
}
button.reset {
    color: #71717a;
}
</style>
