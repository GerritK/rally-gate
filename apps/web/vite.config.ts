import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 57440,
  },
  // @rally-gate/shared ships a CommonJS build and is a symlinked workspace
  // package, so Vite's dev server skips it during dependency pre-bundling
  // by default and loads the raw CJS file as native ESM — named imports
  // then fail (exports.Foo isn't visible as `import { Foo }`). Forcing it
  // into optimizeDeps makes esbuild convert it to ESM like a normal dep.
  optimizeDeps: {
    include: ['@rally-gate/shared'],
  },
});
