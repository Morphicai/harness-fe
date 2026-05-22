import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { harnessFE } from '@harness-fe/vite';

export default defineConfig({
    plugins: [harnessFE({ projectId: 'vue-demo' }), vue()],
    server: {
        port: 5174,
    },
});
