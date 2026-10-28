import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.PULSE_API_URL || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: { output: { manualChunks: { charts: ['recharts'], react: ['react', 'react-dom', 'react-router-dom'] } } },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/v1': API,
      '/ws': { target: API.replace(/^http/, 'ws'), ws: true },
    },
  },
});
