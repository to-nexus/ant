import { defineConfig } from 'vitest/config';
import path from 'path';

// @ant/cloud test suite — covers the billing/cloud-auth adapters + routes that
// physically moved here in P2. OSS-resident ports/constants/JwtService are
// reached via relative `../ant-cli/src/...` imports (in-place monorepo); P3's
// repo split resolves those through the `ant` submodule.
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
