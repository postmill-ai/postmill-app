import { describe, expect, it } from 'vitest';
import { ConfigurationChecker } from './configuration.checker';

const checkerWithStorage = (storageProvider?: string) => {
  const checker = new ConfigurationChecker();
  checker.cfg = {
    STORAGE_PROVIDER: storageProvider,
    S3_ACCESS_KEY_ID: 'access',
    S3_SECRET_ACCESS_KEY: 'do-not-print-this-secret',
    S3_BUCKET: 'bucket',
    S3_REGION: 'fsn1',
    S3_ENDPOINT: 'https://fsn1.your-objectstorage.com',
    S3_PUBLIC_URL: 'https://bucket.fsn1.your-objectstorage.com',
  };
  return checker;
};

describe('ConfigurationChecker storage validation', () => {
  it('accepts the default local configuration', () => {
    const checker = checkerWithStorage();
    checker.checkStorage();
    expect(checker.hasFatalIssues()).toBe(false);
  });

  it('accepts a complete S3 configuration', () => {
    const checker = checkerWithStorage('s3');
    checker.checkStorage();
    expect(checker.hasFatalIssues()).toBe(false);
  });

  it('makes an unknown storage provider fatal', () => {
    const checker = checkerWithStorage('unknown');
    checker.checkStorage();
    expect(checker.getFatalIssues()).toContain(
      'STORAGE_PROVIDER must be either "local" or "s3".',
    );
  });

  it('reports missing settings without exposing credentials', () => {
    const checker = checkerWithStorage('s3');
    delete checker.cfg.S3_BUCKET;
    checker.checkStorage();
    expect(checker.getFatalIssues()).toContain(
      'S3_BUCKET is required when STORAGE_PROVIDER=s3.',
    );
    expect(checker.getIssues().join('\n')).not.toContain('do-not-print-this-secret');
  });
});
