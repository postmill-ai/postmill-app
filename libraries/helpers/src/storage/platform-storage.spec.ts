import { describe, expect, it } from 'vitest';
import {
  getPlatformS3Config,
  getPlatformS3PublicUrl,
  getPlatformStorageConfig,
  getPlatformStorageProvider,
} from './platform-storage';

const s3Env = {
  STORAGE_PROVIDER: 's3',
  S3_ACCESS_KEY_ID: 'access',
  S3_SECRET_ACCESS_KEY: 'secret',
  S3_BUCKET: 'postmill-test',
  S3_REGION: 'fsn1',
  S3_ENDPOINT: 'https://fsn1.your-objectstorage.com/',
  S3_PUBLIC_URL: 'https://postmill-test.fsn1.your-objectstorage.com/',
};

describe('platform storage configuration', () => {
  it('defaults to local when STORAGE_PROVIDER is unset or empty', () => {
    expect(getPlatformStorageConfig({})).toEqual({ provider: 'local' });
    expect(getPlatformStorageConfig({ STORAGE_PROVIDER: '  ' })).toEqual({
      provider: 'local',
    });
  });

  it('normalizes the provider selection', () => {
    expect(getPlatformStorageProvider({ STORAGE_PROVIDER: ' S3 ' })).toBe('s3');
  });

  it('rejects an unknown provider', () => {
    expect(() => getPlatformStorageProvider({ STORAGE_PROVIDER: 'ftp' })).toThrow(
      'STORAGE_PROVIDER must be either "local" or "s3".',
    );
  });

  it('loads and normalizes a valid S3 configuration', () => {
    expect(getPlatformStorageConfig(s3Env)).toEqual({
      provider: 's3',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      bucket: 'postmill-test',
      region: 'fsn1',
      endpoint: 'https://fsn1.your-objectstorage.com',
      publicUrl: 'https://postmill-test.fsn1.your-objectstorage.com',
    });
  });

  it('loads the frontend redirect URL without bucket credentials', () => {
    expect(
      getPlatformS3PublicUrl({
        S3_PUBLIC_URL: 'https://postmill-test.fsn1.your-objectstorage.com/',
      }),
    ).toBe('https://postmill-test.fsn1.your-objectstorage.com');
  });

  it.each([
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_BUCKET',
    'S3_REGION',
    'S3_PUBLIC_URL',
  ])('requires %s in S3 mode', (key) => {
    const env = { ...s3Env, [key]: ' ' };
    expect(() => getPlatformS3Config(env)).toThrow(
      `${key} is required when STORAGE_PROVIDER=s3.`,
    );
  });

  it('allows a native AWS endpoint to be omitted', () => {
    const { S3_ENDPOINT: _endpoint, ...env } = s3Env;
    expect(getPlatformS3Config(env).endpoint).toBeUndefined();
  });

  it.each(['S3_ENDPOINT', 'S3_PUBLIC_URL'])('validates %s', (key) => {
    expect(() => getPlatformS3Config({ ...s3Env, [key]: 'file:///tmp/bucket' })).toThrow(
      `${key} must be a valid HTTP or HTTPS URL.`,
    );
  });
});
