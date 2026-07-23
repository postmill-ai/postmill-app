import { defineConfig } from 'vitest/config';
import path from 'path';

// Integration config: runs `*.int-spec.ts` against a REAL Postgres database stood up
// per run by vitest-integration.global.ts. The `.int-spec.ts` suffix does NOT match the
// unit config's `src/**/*.spec.ts` glob, so unit runs ignore these specs. No setupFiles —
// integration tests hit a real DB and must NOT load the unit mocks (vitest.setup.ts).
export default defineConfig({
  resolve: {
    alias: [
      { find: '@postmill-ai/nestjs-libraries', replacement: path.resolve(__dirname, 'src') },
      { find: '@postmill-ai/helpers', replacement: path.resolve(__dirname, '../helpers/src') },
      { find: '@postmill-ai/backend', replacement: path.resolve(__dirname, '../../apps/backend/src') },
      { find: '@postmill-ai/provider-kernel', replacement: path.resolve(__dirname, '../providers/kernel/src') },
      { find: /^@postmill-ai\/provider-(.+)$/, replacement: path.resolve(__dirname, '../providers/$1/src') },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.int-spec.ts'],
    exclude: ['node_modules', 'dist'],
    globalSetup: ['./vitest-integration.global.ts'],
    pool: 'threads',
    maxWorkers: 1,
    isolate: true,
  },
});
