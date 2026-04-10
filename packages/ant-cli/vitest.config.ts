import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@ant/shared': path.resolve(__dirname, '../ant-shared/src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e-mock/**'],
    testTimeout: 30000,
  },
});
