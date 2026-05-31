import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The console SPA is served by @harness-fe/gateway at `/console/`. `base`
 * makes every asset URL resolve under that prefix.
 */
export default defineConfig({
    base: '/console/',
    plugins: [react()],
    server: {
        port: 5175,
        strictPort: false,
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            output: {
                manualChunks: {
                    react: ['react', 'react-dom'],
                    router: ['react-router-dom'],
                },
            },
        },
    },
});
