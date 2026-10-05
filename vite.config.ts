/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// base './' so the build works from any sub-path (GitHub Pages serves under /<repo>/).
export default defineConfig({
  base: './',
  plugins: [preact()],
  build: { target: 'es2020', sourcemap: true },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
