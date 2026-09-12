import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/browser/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    // Browser startup and real UI/host round trips need room under local load.
    // Request-deadline behavior is asserted separately with a controlled clock.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
