import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app always talks to its own origin (/api, /ws). The proxy below exists
// only for `npm run dev` convenience, pointing at the local Express server.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  test: {
    globals: true, // lets @testing-library/react auto-clean the DOM between tests
    environment: 'jsdom',
    setupFiles: ['./test/setup.js'],
    include: ['test/**/*.test.jsx'],
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: false },
      '/ws': { target: 'http://localhost:8080', ws: true },
    },
  },
});
