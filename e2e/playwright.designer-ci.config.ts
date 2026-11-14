import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  throw new Error('The production Designer browser server may only start on a GitHub-hosted runner.');
}

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/96-designer-export.spec.ts'],
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: './test-results-designer-ci',
  webServer: {
    command: 'pnpm --filter ./apps/frontend exec next start --hostname 127.0.0.1 --port 4200',
    cwd: path.resolve(__dirname, '..'),
    url: 'http://127.0.0.1:4200/auth',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'production',
      NEXT_PUBLIC_BACKEND_URL: 'https://api.postmill.ai',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:4200',
    storageState: { cookies: [], origins: [] },
    ignoreHTTPSErrors: false,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-production',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
});
