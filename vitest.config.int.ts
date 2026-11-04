import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.int-spec.ts'],
    setupFiles: ['./test/setup-unit.ts'],
    hookTimeout: 120_000,
  },
});
