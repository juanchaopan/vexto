import { defineConfig, devices } from '@playwright/test';

// Two ways to run:
//   - inside the pinned Playwright Linux container (`task test-e2e`), against a production build
//     started on a free port; screenshots are compared only here, so baselines match pixel for pixel;
//   - against a deployed application (`task test-smoke -- <url>`), with screenshots skipped.
const deployedUrl = process.env.E2E_BASE_URL;
const inContainer = process.env.E2E_CONTAINER === '1';
const port = process.env.E2E_PORT;

if (!deployedUrl && !(inContainer && port)) {
  throw new Error(
    'Run end-to-end tests with `task test-e2e` and smoke tests with `task test-smoke -- <url>`.',
  );
}

const baseURL = deployedUrl ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never' }]],
  ignoreSnapshots: !inContainer,
  // CI only compares; missing baselines are written on local runs in the container.
  updateSnapshots: process.env.CI ? 'none' : 'missing',
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css' },
  },
  use: {
    baseURL,
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 17'] } },
    { name: 'android-chromium', use: { ...devices['Pixel 10'] } },
  ],
  webServer: deployedUrl
    ? undefined
    : {
        command: `pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: false,
        timeout: 60_000,
      },
});
