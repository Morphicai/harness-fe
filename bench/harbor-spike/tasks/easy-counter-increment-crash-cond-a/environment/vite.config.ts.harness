// 条件 A vite config：与 bench/bench/runner.py 的 _REACT_VITE_CONFIG_WITH_HARNESS
// 模板一致（projectId + loopback daemon ws 地址）。
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { harnessFE } from '@harness-fe/vite';

export default defineConfig({
    plugins: [
        harnessFE({ projectId: 'react-demo', mcpUrl: 'ws://127.0.0.1:47729/ws' }),
        react(),
    ],
});
