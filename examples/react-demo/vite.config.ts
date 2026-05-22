import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { harnessFE } from '@harness-fe/vite';

export default defineConfig({
    plugins: [harnessFE({ projectId: 'react-demo' }), react()],
    server: {
        port: 5173,
    },
});
