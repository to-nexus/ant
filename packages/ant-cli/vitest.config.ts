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
    testTimeout: 30000,
  },
});
