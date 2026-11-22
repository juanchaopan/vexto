import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Test kinds are told apart by file name, so a test can sit next to the code it tests:
//   *.test.ts             unit tests in Node
//   *.test.tsx            component tests in real browsers
//   *.integration.test.ts integration tests from the route entry inward
//   *.security.test.ts    sign-in, permission, data isolation and hostile input cases
//   *.migration.test.ts   migration scripts run against data in the previous format
const typedTests = ['integration', 'security', 'migration'].map((kind) => `**/*.${kind}.test.ts`);

// Phone-size viewport, matching the devices the application is built for.
const phoneViewport = { width: 390, height: 844 };

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: typedTests,
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          include: ['src/**/*.test.tsx'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            viewport: phoneViewport,
            instances: [{ browser: 'chromium' }, { browser: 'webkit' }],
          },
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['src/**/*.integration.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'security',
          environment: 'node',
          include: ['src/**/*.security.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'migration',
          environment: 'node',
          include: ['src/**/*.migration.test.ts', 'drizzle/**/*.migration.test.ts'],
        },
      },
    ],
  },
});
