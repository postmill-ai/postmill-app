import type { GlobalSetupContext } from 'vitest/node';
import { createTestDatabase } from './src/testing/test-db';

// Expose the per-run test DB URL to worker threads via vitest provide/inject.
// (process.env mutations in globalSetup do not reliably reach the worker pool.)
declare module 'vitest' {
  export interface ProvidedContext {
    dbUrl: string;
  }
}

export default async function globalSetup({ provide }: GlobalSetupContext) {
  const { url, drop } = await createTestDatabase();
  provide('dbUrl', url);
  return async () => {
    await drop();
  };
}
