import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/96-designer-generated-video.spec.ts',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: './test-results-designer',
  use: {
    baseURL: process.env.E2E_BASE || 'http://localhost:4200',
    storageState: process.env.E2E_AUTH_STATE || '.auth/admin.json',
    viewport: { width: 1440, height: 1000 },
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
});
