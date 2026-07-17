import { metadata as providerMetadata } from './metadata';
import { makeS3StorageModule } from '@gitroom/provider-kernel';

export const hetznerStorageModule = makeS3StorageModule({
  type: 'HETZNER',
  displayName: 'Hetzner',
  credentialFields: [
    { key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
  ],
  resolveRegion: (region) => region || 'fsn1',
  resolveEndpoint: (region, endpoint) =>
    endpoint || `https://${region}.your-objectstorage.com`,
});

hetznerStorageModule.metadata = providerMetadata;
