export const ORG_EXPORT_SCHEMA = 'postmill.org-export.v1';
export const ORG_PORTABILITY_EXPORT_EVENT = 'org/portability.export';
export const ORG_PORTABILITY_IMPORT_EVENT = 'org/portability.import';
export const ORG_PORTABILITY_JOB_TTL_HOURS = 24;
export const ORG_PORTABILITY_BATCH_SIZE = 250;
export const ORG_PORTABILITY_MAX_ARCHIVE_BYTES = 4n * 1024n * 1024n * 1024n - 1024n * 1024n;
export const ORG_PORTABILITY_MAX_ASSET_BYTES = 2n * 1024n * 1024n * 1024n - 1n;
export const ORG_PORTABILITY_MAX_DOMAIN_BYTES = 64 * 1024 * 1024;

const envBytes = (name: string, fallback: bigint): bigint => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = BigInt(raw);
  if (value <= 0n) throw new Error(`${name} must be a positive integer`);
  return value;
};
export const orgPortabilityMaxArchiveBytes = () => {
  const configured = envBytes('ORG_PORTABILITY_MAX_ARCHIVE_BYTES', ORG_PORTABILITY_MAX_ARCHIVE_BYTES);
  return configured < ORG_PORTABILITY_MAX_ARCHIVE_BYTES ? configured : ORG_PORTABILITY_MAX_ARCHIVE_BYTES;
};
export const orgPortabilityMaxAssetBytes = () =>
  envBytes('ORG_PORTABILITY_MAX_ASSET_BYTES', ORG_PORTABILITY_MAX_ASSET_BYTES);

export const ORG_PORTABILITY_EXCLUDED_MODELS = new Set([
  'OrgPortabilityJob',
  'UserOrganization',
  'AppRole',
  'Credits',
  'Subscription',
  'PaymentEvent',
  'OAuthApp',
  'OAuthAuthorization',
  'FederationGrant',
  'ApiKey',
  'Session',
  'PushToken',
  'NotificationDigestQueue',
  'MultipartUpload',
  'InngestFunctionRun',
  'MigrationLedger',
  'AIMediaJob',
  'AiDesignerSession',
  'AuditLog',
  'EmailLog',
  'Errors',
]);

export const ORG_PORTABILITY_SECRET_FIELDS: Record<string, string[]> = {
  Integration: ['token', 'refreshToken', 'customInstanceDetails'],
  OrgProviderConfiguration: ['clientId', 'clientSecret', 'additionalConfig'],
  StorageProviderConfig: ['credentials'],
  AIOrgProviderConfig: ['credentials'],
  MediaProviderConfig: ['credentials'],
  OrgShortLinkConfig: ['credentials'],
  OrgVpnConfig: ['credentials'],
  CommsProviderConfig: ['credentials'],
  ContentPackConfig: ['credentials'],
};

export const ORG_PORTABILITY_REGENERATED_TOKEN_FIELDS: Record<string, string[]> = {
  AnalyticsShare: ['token'],
  Campaign: ['shareToken'],
  CommsProviderConfig: ['webhookToken'],
  CommsUserLink: ['connectCode'],
};

export interface OrgPortabilitySecretRef {
  model: string;
  id: string;
  field: string;
  value: string;
}

export interface OrgPortabilityAssetManifest {
  fileId: string;
  sha256: string;
  size: string;
  mime: string;
  missing?: boolean;
}

export interface OrgPortabilityManifest {
  schema: typeof ORG_EXPORT_SCHEMA;
  appVersion: string;
  createdAt: string;
  source: { organizationId: string; name: string };
  counts: Record<string, number>;
  domains: Record<string, string>;
  assets: Record<string, OrgPortabilityAssetManifest>;
  crypto: {
    kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string };
    wrappedKey: { algorithm: 'aes-256-gcm'; iv: string; ciphertext: string; tag: string };
    secrets: { algorithm: 'aes-256-gcm'; iv: string; ciphertext: string; tag: string };
  };
  integrity: { algorithm: 'hmac-sha256'; mac: string };
}
