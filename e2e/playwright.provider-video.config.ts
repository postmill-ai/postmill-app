import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/97-provider-video-workflows.spec.ts'],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE || 'http://localhost:4201',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: '**/auth.setup.ts' },
    {
      name: 'admin',
      use: { ...devices['Desktop Chrome'], storageState: process.env.E2E_AUTH_STATE || '.auth/admin.json' },
      dependencies: process.env.E2E_SKIP_AUTH_SETUP === '1' ? [] : ['setup'],
    },
  ],
});
