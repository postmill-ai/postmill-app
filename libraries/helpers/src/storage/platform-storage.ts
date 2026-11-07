export type StorageEnv = Record<string, string | undefined>;

export interface PlatformLocalStorageConfig {
  provider: 'local';
}

export interface PlatformS3StorageConfig {
  provider: 's3';
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  endpoint?: string;
  publicUrl: string;
}

export type PlatformStorageConfig =
  | PlatformLocalStorageConfig
  | PlatformS3StorageConfig;

const requiredS3Variables = [
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_BUCKET',
  'S3_REGION',
  'S3_PUBLIC_URL',
] as const;

const requiredValue = (env: StorageEnv, key: string) => {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required when STORAGE_PROVIDER=s3.`);
  }
  return value;
};

const httpUrl = (value: string, key: string) => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid HTTP or HTTPS URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${key} must be a valid HTTP or HTTPS URL.`);
  }
  return value.replace(/\/+$/, '');
};

export const getPlatformStorageProvider = (
  env: StorageEnv = process.env,
): 'local' | 's3' => {
  const value = env.STORAGE_PROVIDER?.trim().toLowerCase() || 'local';
  if (value !== 'local' && value !== 's3') {
    throw new Error('STORAGE_PROVIDER must be either "local" or "s3".');
  }
  return value;
};

export const getPlatformS3PublicUrl = (env: StorageEnv = process.env) =>
  httpUrl(requiredValue(env, 'S3_PUBLIC_URL'), 'S3_PUBLIC_URL');

export const getPlatformS3Config = (
  env: StorageEnv = process.env,
): PlatformS3StorageConfig => {
  for (const key of requiredS3Variables) requiredValue(env, key);

  const endpoint = env.S3_ENDPOINT?.trim();
  return {
    provider: 's3',
    accessKeyId: requiredValue(env, 'S3_ACCESS_KEY_ID'),
    secretAccessKey: requiredValue(env, 'S3_SECRET_ACCESS_KEY'),
    bucket: requiredValue(env, 'S3_BUCKET'),
    region: requiredValue(env, 'S3_REGION'),
    endpoint: endpoint
      ? httpUrl(endpoint, 'S3_ENDPOINT')
      : undefined,
    publicUrl: getPlatformS3PublicUrl(env),
  };
};

export const getPlatformStorageConfig = (
  env: StorageEnv = process.env,
): PlatformStorageConfig =>
  getPlatformStorageProvider(env) === 's3'
    ? getPlatformS3Config(env)
    : { provider: 'local' };
