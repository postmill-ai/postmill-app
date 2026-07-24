import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@postmill-ai/provider-kernel': path.resolve(__dirname, '../kernel/src'),
      '@postmill-ai/provider-kernel/*': path.resolve(__dirname, '../kernel/src/*'),
      '@postmill-ai/nestjs-libraries': path.resolve(__dirname, '../../nestjs-libraries/src'),
      '@postmill-ai/helpers': path.resolve(__dirname, '../../helpers/src'),
      '@postmill-ai/backend': path.resolve(__dirname, '../../../apps/backend/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'src/**/*.int-spec.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
