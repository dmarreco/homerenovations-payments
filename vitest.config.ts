import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/functions/**/*.ts'],
    },
  },
  resolve: {
    alias: {
      '@domain': path.resolve(__dirname, 'src/domain'),
      '@adapters': path.resolve(__dirname, 'src/adapters'),
      '@lib': path.resolve(__dirname, 'src/lib'),
      '@ports': path.resolve(__dirname, 'src/ports'),
      '@types': path.resolve(__dirname, 'src/types'),
    },
  },
});
