import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { harnessaFE } from '@harnessa-fe/vite';

export default defineConfig({
    plugins: [harnessaFE({ projectId: 'react-demo' }), react()],
    server: {
        port: 5173,
    },
});
