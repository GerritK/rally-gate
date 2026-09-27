import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  root: 'web',
  plugins: [vue()],
  build: {
    // Full Vuetify registration (packages/ui/src/vuetify.ts) is one ~600 kB
    // chunk. Served from localhost/LAN, never a CDN, so that is not worth
    // per-app tree-shaking config.
    chunkSizeWarningLimit: 1024,
  },
  server: {
    port: 57449,
    // Dev loop: Vite serves the page, the Node service answers the API. In
    // production the same Node service serves both from web/dist.
    proxy: { '/api': 'http://localhost:57439' },
  },
});
