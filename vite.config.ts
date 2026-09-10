import { defineConfig } from 'vite';

export default defineConfig({
  base: '/inkfall/',
  build: {
    target: 'es2022',
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 2000,
  },
  server: { port: 5173, strictPort: true },
});
