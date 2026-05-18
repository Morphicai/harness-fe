import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { harnessaFE } from '@harnessa-fe/vite';

export default defineConfig({
    plugins: [harnessaFE({ projectId: 'vue-demo' }), vue()],
    server: {
        port: 5174,
    },
});
