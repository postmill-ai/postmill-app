import { metadata as providerMetadata } from './metadata';
import { makeS3StorageModule } from '@gitroom/provider-kernel';

export const vultrStorageModule = makeS3StorageModule({
  type: 'VULTR',
  displayName: 'Vultr Object Storage',
  credentialFields: [
    { key: 'accessKeyId', label: 'Access Key ID', type: 'password', required: true },
    { key: 'secretAccessKey', label: 'Secret Access Key', type: 'password', required: true },
  ],
  resolveRegion: (region) => region || 'ewr1',
  resolveEndpoint: (region, endpoint) =>
    endpoint || `https://${region}.vultrobjects.com`,
});

vultrStorageModule.metadata = providerMetadata;
