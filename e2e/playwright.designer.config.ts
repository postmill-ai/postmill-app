import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/96-designer-*.spec.ts',
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
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: 'touch',
      testMatch: '**/96-designer-generated-video.spec.ts',
      grep: /Designer mobile workspace/,
      use: { ...devices['Pixel 7'], viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true },
    },
  ],
});
