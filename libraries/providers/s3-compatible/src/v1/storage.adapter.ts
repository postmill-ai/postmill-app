import { metadata as providerMetadata } from './metadata';
import { makeS3StorageModule } from '@gitroom/provider-kernel';

export const s3compatibleStorageModule = makeS3StorageModule({
  type: 'S3_COMPATIBLE',
  displayName: 'S3-Compatible',
  credentialFields: [
    { key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
  ],
  resolveRegion: (region) => region || 'us-east-1',
  resolveEndpoint: (_region, endpoint) => {
    if (!endpoint) {
      throw new Error(
        'A generic S3-compatible provider requires a custom endpoint URL ' +
          '(e.g. https://s3.example.com).',
      );
    }
    return endpoint;
  },
});

s3compatibleStorageModule.metadata = providerMetadata;
