import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './live-ai-designer',
  testMatch: ['**/ai-designer-live.spec.ts'],
  timeout: 600_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: './test-results/ai-designer-live',
  use: {
    actionTimeout: 45_000,
    baseURL: process.env.E2E_BASE,
    storageState: process.env.E2E_AUTH_STATE || '.auth/admin.json',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'admin',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
});
