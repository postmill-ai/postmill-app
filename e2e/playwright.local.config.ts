import base from './playwright.config';
import { defineConfig } from '@playwright/test';

// Local run: point at the host dev servers instead of the remote deployment.
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://localhost:4200' },
});
