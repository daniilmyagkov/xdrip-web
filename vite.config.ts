/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// base './' so the build works from any sub-path (GitHub Pages serves under /<repo>/).
const buildDate = new Date().toLocaleDateString('sv-SE'); // local YYYY-MM-DD

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(`0.1.0 · ${buildDate}`) },
  plugins: [preact()],
  build: { target: 'es2020', sourcemap: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
