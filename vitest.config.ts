import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// Test kinds are told apart by file name, so a test can sit next to the code it tests:
//   *.test.ts             unit tests in Node, for the application and the project scripts
//   *.test.tsx            component tests in real browsers
//   *.integration.test.ts integration tests from the route entry inward
//   *.security.test.ts    sign-in, permission, data isolation and hostile input cases
//   *.migration.test.ts   migration scripts run against data in the previous format
// The named Node kinds are listed with the directories their tests live in, and whether they run
// against the throwaway PostgreSQL and S3Mock containers of scripts/lib/test-services.ts.
const nodeTestKinds = [
  { kind: 'integration', roots: ['src', 'scripts'], services: true },
  { kind: 'security', roots: ['src'], services: true },
  { kind: 'migration', roots: ['src', 'drizzle'], services: false },
];
const namedNodeTests = nodeTestKinds.map(({ kind }) => `**/*.${kind}.test.ts`);

// The global setup starts the containers once per run and the setup file puts their runtime
// values into process.env of every test file.
const testServices = {
  globalSetup: ['scripts/test-services-setup.ts'],
  setupFiles: ['scripts/test-services-env.ts'],
};

// Phone-size viewport, matching the devices the application is built for.
const phoneViewport = { width: 390, height: 844 };

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: namedNodeTests,
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
      ...nodeTestKinds.map(({ kind, roots, services }) => ({
        extends: true as const,
        test: {
          name: kind,
          environment: 'node',
          include: roots.map((root) => `${root}/**/*.${kind}.test.ts`),
          ...(services ? testServices : {}),
        },
      })),
    ],
  },
});
