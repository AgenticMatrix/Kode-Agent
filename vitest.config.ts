import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/*/src/**/*.spec.ts',
      'packages/*/__tests__/**/*.test.ts',
      'packages/*/__tests__/**/*.spec.ts',
      'packages/*/test/**/*.test.ts',
      'packages/*/test/**/*.spec.ts',
    ],
    exclude: ['node_modules', 'dist', '**/fixtures/**'],
    setupFiles: ['./configs/test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/index.ts',
        'packages/*/src/**/*.test.ts',
        'packages/*/src/**/*.spec.ts',
        'packages/*/src/**/types.ts',
        'packages/*/src/types/**',
      ],
      // Coverage thresholds — enforced in CI
      thresholds: {
        lines: 80,
        branches: 75,
        functions: 80,
        statements: 80,
      },
      reporter: ['text', 'text-summary', 'lcov', 'html'],
      reportsDirectory: './coverage',
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    // Fail on console.error / console.warn in tests (catch real issues)
    onConsoleLog(log: string, type: 'stdout' | 'stderr'): boolean | void {
      if (type === 'stderr' && log.includes('Warning:')) {
        return false; // Suppress warnings from deps
      }
    },
  },
});
