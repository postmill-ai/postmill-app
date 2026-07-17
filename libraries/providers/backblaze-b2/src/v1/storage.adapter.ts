import { metadata as providerMetadata } from './metadata';
import { makeS3StorageModule } from '@gitroom/provider-kernel';

export const backblazeb2StorageModule = makeS3StorageModule({
  type: 'BACKBLAZE_B2',
  displayName: 'Backblaze B2',
  credentialFields: [
    { key: 'keyId', label: 'Key ID', type: 'password', required: true },
    { key: 'applicationKey', label: 'Application Key', type: 'password', required: true },
  ],
  resolveEndpoint: (region, endpoint) =>
    endpoint || `https://s3.${region}.backblazeb2.com`,
});

backblazeb2StorageModule.metadata = providerMetadata;
