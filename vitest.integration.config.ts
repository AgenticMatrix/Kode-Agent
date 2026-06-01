import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default mergeConfig(baseConfig, defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.integration.test.ts',
      'packages/*/__tests__/**/*.integration.test.ts',
    ],
    testTimeout: 60000,
    hookTimeout: 60000,
    // Integration tests may use real services — relax coverage thresholds
    coverage: {
      thresholds: undefined,
    },
  },
}));
