import { defineConfig } from 'vite';
export default defineConfig({ base: '/quantum-market-sentinel/', build: { target: 'es2022', chunkSizeWarningLimit: 900 } });
