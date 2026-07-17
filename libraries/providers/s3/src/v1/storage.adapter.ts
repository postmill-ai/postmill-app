import { metadata as providerMetadata } from './metadata';
import { makeS3StorageModule } from '@gitroom/provider-kernel';

export const s3StorageModule = makeS3StorageModule({
  type: 'S3',
  displayName: 'AWS S3',
  credentialFields: [
    { key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
  ],
});

s3StorageModule.metadata = providerMetadata;
