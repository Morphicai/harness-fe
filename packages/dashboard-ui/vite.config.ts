import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dashboard is served by @harnessa-fe/mcp-server at `/dashboard/`.
// All asset URLs need to resolve under that prefix; `base` handles that.
//
// Dev server picks a different port from examples/react-demo (5173) and
// examples/webpack-demo (3000-ish) so we can run them side-by-side.
export default defineConfig({
    base: '/dashboard/',
    plugins: [react()],
    server: {
        port: 5174,
        strictPort: false,
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        // Smaller chunks make the mcp-server tarball more browser-cache-friendly
        // when only one route changes between releases.
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
