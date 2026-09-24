import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'web',
  plugins: [vue()],
  server: {
    port: 57449,
    // Dev loop: Vite serves the page, the Node service answers the API. In
    // production the same Node service serves both from web/dist.
    proxy: { '/api': 'http://localhost:57439' },
  },
});
