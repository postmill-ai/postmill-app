import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  throw new Error('The production Brand Studio browser server may only start on a GitHub-hosted runner.');
}

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/98-brand-studio.spec.ts'],
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: './test-results-brand-studio-ci',
  webServer: {
    command: 'pnpm --filter ./apps/frontend exec next start --hostname 127.0.0.1 --port 4201',
    cwd: path.resolve(__dirname, '..'),
    url: 'http://127.0.0.1:4201/auth',
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
    baseURL: 'http://127.0.0.1:4201',
    storageState: {
      cookies: [{
        name: 'auth',
        value: 'mocked-brand-studio-e2e',
        domain: '127.0.0.1',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      }],
      origins: [],
    },
    ignoreHTTPSErrors: false,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'brand-studio-production',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
});
