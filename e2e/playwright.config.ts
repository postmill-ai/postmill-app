import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'https://app.postmill.ai',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: '**/auth.setup.ts',
    },
    {
      // Named 'admin' (not 'chromium') because persona-aware specs read
      // test.info().project.name (e.g. 94-setup-rbac) — this project runs the
      // super-admin session from .auth/admin.json.
      name: 'admin',
      use: {
        ...devices['Desktop Chrome'],
        // auth.setup.ts writes one state per persona (admin/member/free);
        // the main sweep runs as admin (super-admin sees every surface).
        storageState: '.auth/admin.json',
      },
      dependencies: ['setup'],
    },
  ],
});
