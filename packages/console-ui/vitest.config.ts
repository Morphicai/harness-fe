import { defineConfig } from 'vitest/config';

// renderHook / react-dom need a DOM; happy-dom is the lightweight one.
export default defineConfig({
    test: {
        environment: 'happy-dom',
    },
});
